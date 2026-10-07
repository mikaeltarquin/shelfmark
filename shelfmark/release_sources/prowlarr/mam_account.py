"""MyAnonamouse account: stats, connection status and upload credit purchases.

Uses the same session ID (``PROWLARR_MAM_ID``) as the search enrichment in ``mam``.
Account stats come from ``jsonLoad.php``; upload credit is bought in MAM's bonus point
store (``json/bonusBuy.php``), the way MouseSearch does it.

Purchases are split into 100 GB and 50 GB buys (250 GB is 100 + 100 + 50), the sizes
MAM's store sells, and stop at the first one that fails. "Max affordable" is a single
request that MAM sizes itself. Purchases are serialized and never retried.
"""

from __future__ import annotations

import math
import re
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any

import requests

from shelfmark.core.config import config
from shelfmark.core.logger import setup_logger
from shelfmark.core.request_helpers import normalize_optional_text
from shelfmark.release_sources.prowlarr.mam import MamClient, MamError
from shelfmark.release_sources.prowlarr.mam_charge import (
    mam_charge_bytes_for_release,
    mam_torrent_id_for_release,
)

logger = setup_logger(__name__)

# Below this the ratio line warns: MAM's minimum for renewing VIP.
RATIO_WARNING = 2.0

UPLOAD_CREDIT_POINTS_PER_GB = 500
UPLOAD_CREDIT_STEP_GB = 50
UPLOAD_CREDIT_CHUNKS_GB = (100, 50)
MAX_AFFORDABLE = "max"
# What MAM's store sends for its "Max Affordable" option, trailing space included.
_MAX_AFFORDABLE_PARAM = "Max Affordable "

_STATS_TTL_SECONDS = 60
# How far behind MAM's unsatisfied count may be: snatches this long before the stats
# were read are counted as Shelfmark's own too.
_UNSAT_LAG_SECONDS = 15 * 60
# MAM's unsatisfied count as read, (when, count), oldest first: to tell how many of
# Shelfmark's recent snatches it already shows (see `_uncounted_snatches`).
_UNSAT_SAMPLE_SECONDS = 2 * 3600
_unsat_samples: list[tuple[float, int]] = []
_unsat_lock = threading.Lock()
_GIB = 1024**3
_SIZE_RE = re.compile(r"^\s*([-+]?\d+(?:\.\d+)?)\s*([KMGTP]?i?B)?\s*$", re.IGNORECASE)
_SIZE_UNITS = {"": _GIB, "B": 1, "K": 1024, "M": 1024**2, "G": _GIB, "T": 1024**4, "P": 1024**5}

MAM_ERRORS = (MamError, requests.exceptions.RequestException, ValueError)


def describe_error(exc: BaseException) -> str:
    """A readable one-line reason for a failed MAM request."""
    if isinstance(exc, requests.exceptions.Timeout):
        return "MyAnonamouse did not answer in time"
    if isinstance(exc, requests.exceptions.ConnectionError):
        detail = (
            "proxy error" if isinstance(exc, requests.exceptions.ProxyError) else "network error"
        )
        return (
            f"Could not reach MyAnonamouse ({detail}); check Shelfmark's network and proxy settings"
        )
    return str(exc) or type(exc).__name__


class MamNotConfiguredError(MamError):
    """No MAM session ID is set."""


@dataclass(frozen=True)
class MamStats:
    """The account figures Shelfmark shows and acts on."""

    username: str | None
    classname: str | None
    uploaded_bytes: int
    downloaded_bytes: int
    ratio: float | None  # None when MAM reports none (nothing downloaded yet)
    seedbonus: float
    vip_until: str | None
    # Torrents not yet seeded for MAM's required 72 hours, and how many the class allows.
    unsat_count: int | None = None
    unsat_limit: int | None = None
    uid: int | None = None  # The account's user id, for a link to its profile page
    fetched_at: float = field(default_factory=time.time)

    @property
    def buffer_bytes(self) -> int:
        """Upload headroom: how much can be downloaded before the ratio drops below 1."""
        return self.uploaded_bytes - self.downloaded_bytes

    def to_dict(self) -> dict[str, Any]:
        """Serialize for the API, with the buffer included."""
        return {**asdict(self), "buffer_bytes": self.buffer_bytes}


@dataclass(frozen=True)
class PurchaseResult:
    """Outcome of an upload credit purchase; a partial one has success False and amount_gb > 0."""

    success: bool
    amount_gb: float
    seedbonus: float | None
    error: str | None = None


def session_id() -> str:
    """The configured MAM session ID, or an empty string."""
    return normalize_optional_text(config.get("PROWLARR_MAM_ID", "")) or ""


def is_configured() -> bool:
    """Whether a MAM session ID is set."""
    return bool(session_id())


def parse_size_bytes(value: object) -> int | None:
    """Read a MAM size ("12.34 GiB", "512 MB", or a byte count) as bytes.

    MAM counts in binary units, so "GB" is taken as GiB, as MouseSearch does.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if not isinstance(value, str):
        return None
    match = _SIZE_RE.match(value.replace(",", ""))
    if not match:
        return None
    suffix = (match.group(2) or "").upper()
    # A bare number is GiB, as MAM writes sizes; otherwise the suffix's first letter.
    unit = "B" if suffix == "B" else suffix[:1]
    return int(float(match.group(1)) * _SIZE_UNITS[unit])


def parse_number(value: object) -> float | None:
    """Read a number given as a number or text ("61,250", "Inf."); None if it isn't one."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).replace(",", "").strip()
    if not text:
        return None
    if "∞" in text or "inf" in text.lower():
        return math.inf
    try:
        return float(text)
    except ValueError:
        return None


def _whole(value: object) -> int | None:
    number = parse_number(value)
    return int(number) if number is not None and math.isfinite(number) else None


def _unsat_summary(data: dict[str, Any]) -> dict[str, Any]:
    """The "unsat" snatch summary: nested under "snatch_summary" since September 2026,
    at the top level before that."""
    nested = data.get("snatch_summary")
    for container in (nested if isinstance(nested, dict) else {}, data):
        unsat = container.get("unsat")
        if isinstance(unsat, dict):
            return unsat
    return {}


def parse_stats(data: dict[str, Any]) -> MamStats:
    """Build MamStats from a jsonLoad.php reply, preferring its exact byte counts."""
    exact_uploaded = parse_size_bytes(data.get("uploaded_bytes"))
    exact_downloaded = parse_size_bytes(data.get("downloaded_bytes"))
    uploaded = exact_uploaded
    if uploaded is None:
        uploaded = parse_size_bytes(data.get("uploaded")) or 0
    downloaded = exact_downloaded
    if downloaded is None:
        downloaded = parse_size_bytes(data.get("downloaded")) or 0
    # The reply's "ratio" text can be coarser than the site shows (1.3 for 1.33),
    # so work it out from the exact byte counts when MAM sends them.
    if exact_uploaded is not None and exact_downloaded:
        ratio = exact_uploaded / exact_downloaded
    else:
        ratio = parse_number(data.get("ratio"))
    username = data.get("username")
    classname = data.get("classname")
    vip_until = data.get("vip_until")
    unsat = _unsat_summary(data)
    return MamStats(
        username=str(username) if username else None,
        classname=str(classname) if classname else None,
        uploaded_bytes=uploaded,
        downloaded_bytes=downloaded,
        ratio=ratio,
        seedbonus=parse_number(data.get("seedbonus")) or 0.0,
        vip_until=str(vip_until) if vip_until else None,
        unsat_count=_whole(unsat.get("count")),
        unsat_limit=_whole(unsat.get("limit")),
        uid=_whole(data.get("uid")),
    )


_cache_lock = threading.Lock()
_cached: tuple[str, MamStats] | None = None
_purchase_lock = threading.Lock()


def _client() -> MamClient:
    mam_id = session_id()
    if not mam_id:
        msg = "No MyAnonamouse session ID is set (Settings > Prowlarr)"
        raise MamNotConfiguredError(msg)
    return MamClient(mam_id)


def get_stats(*, refresh: bool = False) -> MamStats:
    """Return the account's stats, from a short cache unless `refresh` is set."""
    global _cached
    client = _client()
    mam_id = session_id()
    with _cache_lock:
        cached = _cached
    if (
        not refresh
        and cached is not None
        and cached[0] == mam_id
        and time.time() - cached[1].fetched_at < _STATS_TTL_SECONDS
    ):
        return cached[1]
    stats = parse_stats(client.get_user_data())
    with _cache_lock:
        _cached = (mam_id, stats)
    _record_unsat(stats)
    from shelfmark.release_sources.prowlarr import mam_points

    mam_points.record_sample(stats.seedbonus, at=stats.fetched_at)
    return stats


def _record_unsat(stats: MamStats) -> None:
    if stats.unsat_count is None:
        return
    with _unsat_lock:
        _unsat_samples.append((stats.fetched_at, stats.unsat_count))
        cutoff = stats.fetched_at - _UNSAT_SAMPLE_SECONDS
        _unsat_samples[:] = [sample for sample in _unsat_samples if sample[0] >= cutoff]


def _unsat_count_before(at: float) -> int | None:
    """MAM's unsatisfied count as last read at or before `at`, if it was."""
    with _unsat_lock:
        earlier = [count for read_at, count in _unsat_samples if read_at <= at]
    return earlier[-1] if earlier else None


def _uncounted_snatches(handoffs: list[float], unsat_count: int | None) -> int:
    """How many of Shelfmark's recent snatches (handed off at `handoffs`) MAM's
    `unsat_count` doesn't show yet.

    MAM's count lags its snatches, so recent ones are added to it, but once it has
    caught up that counts them twice: a run that filled the slots then saw them full for
    the whole lag allowance (15 minutes), with slots free. So: however far MAM's count
    has risen since just before the first of them, that many are in it already. Counted
    in full when there's no reading from before them (as after a restart). Torrents
    leaving the count meanwhile (satisfied) only make this count more, never fewer.
    """
    if not handoffs:
        return 0
    baseline = _unsat_count_before(min(handoffs)) if unsat_count is not None else None
    if unsat_count is None or baseline is None:
        return len(handoffs)
    return max(0, len(handoffs) - max(0, unsat_count - baseline))


def invalidate_stats() -> None:
    """Drop cached stats so the next read asks MAM again."""
    global _cached
    with _cache_lock:
        _cached = None


def split_purchase(amount_gb: int) -> list[int]:
    """Split a purchase into the 100 GB and 50 GB buys MAM's store sells."""
    if amount_gb < UPLOAD_CREDIT_STEP_GB or amount_gb % UPLOAD_CREDIT_STEP_GB:
        msg = f"Upload credit is bought in multiples of {UPLOAD_CREDIT_STEP_GB} GB"
        raise ValueError(msg)
    chunks: list[int] = []
    remaining = amount_gb
    for size in UPLOAD_CREDIT_CHUNKS_GB:
        count, remaining = divmod(remaining, size)
        chunks.extend([size] * count)
    return chunks


def parse_purchase_amount(value: object) -> int | str:
    """Validate a requested amount: MAX_AFFORDABLE, or whole GB in multiples of 50."""
    if isinstance(value, str) and value.strip().lower() == MAX_AFFORDABLE:
        return MAX_AFFORDABLE
    number = parse_number(value)  # None for booleans too
    if number is None or not math.isfinite(number) or number != int(number):
        msg = "Amount must be a whole number of GB or 'max'"
        raise ValueError(msg)
    split_purchase(int(number))
    return int(number)


def _store_error(reply: dict[str, Any]) -> str:
    for key in ("error", "message", "type"):
        value = reply.get(key)
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())
    return "MyAnonamouse did not accept the purchase"


def _buy_once(client: MamClient, amount: str) -> tuple[bool, float, float | None, str | None]:
    reply = client.bonus_buy({"spendtype": "upload", "amount": amount})
    seedbonus = parse_number(reply.get("seedbonus"))
    if not reply.get("success"):
        return False, 0.0, seedbonus, _store_error(reply)
    bought = parse_number(reply.get("amount"))
    return True, bought or 0.0, seedbonus, None


def purchase_upload_credit(amount: int | str, *, reason: str = "manual") -> PurchaseResult:
    """Buy upload credit: whole GB in multiples of 50, or MAX_AFFORDABLE.

    A request MAM rejects, or that fails on the way, stops the purchase; what was
    already bought is reported in `amount_gb`.
    """
    requested = parse_purchase_amount(amount)
    client = _client()
    chunks: list[str] = (
        [_MAX_AFFORDABLE_PARAM]
        if requested == MAX_AFFORDABLE
        else [str(size) for size in split_purchase(int(requested))]
    )
    total = 0.0
    seedbonus: float | None = None
    error: str | None = None
    with _purchase_lock:
        try:
            for chunk in chunks:
                ok, bought, seedbonus, error = _buy_once(client, chunk)
                if not ok:
                    break
                # MAM reports the GB added; fall back to the size asked for.
                total += bought or (0.0 if chunk == _MAX_AFFORDABLE_PARAM else float(chunk))
        except MAM_ERRORS as exc:
            error = describe_error(exc)
        finally:
            invalidate_stats()
    if error is None and total <= 0:
        error = "No upload credit was added (not enough bonus points?)"
    result = PurchaseResult(
        success=error is None, amount_gb=total, seedbonus=seedbonus, error=error
    )
    if result.success:
        logger.info("Bought %.0f GB of MAM upload credit (%s)", total, reason)
    else:
        logger.warning(
            "MAM upload credit purchase (%s, %s GB) stopped after %.0f GB: %s",
            reason,
            requested,
            total,
            error,
        )
    return result


def _torrent_client_status() -> dict[str, Any]:
    from shelfmark.download.clients import client_label, get_client

    try:
        client = get_client("torrent")
    except (ImportError, RuntimeError, ValueError) as exc:
        return {"configured": False, "ok": False, "name": None, "message": str(exc)}
    if client is None:
        return {
            "configured": False,
            "ok": False,
            "name": None,
            "message": "No torrent client is configured",
        }
    name = client_label(client)
    try:
        ok, message = client.test_connection()
    except (OSError, RuntimeError, ValueError, requests.exceptions.RequestException) as exc:
        ok, message = False, str(exc)
    return {"configured": True, "ok": bool(ok), "name": name, "message": message}


# MAM counts a torrent as satisfied once it has seeded 72 hours.
UNSAT_SEED_SECONDS = 72 * 3600
# "Slots freeing up soon" looks this far ahead.
UNSAT_WINDOW_SECONDS = 6 * 3600
_CLIENT_TTL_SECONDS = 60
# Snatches handed off this long before the client was read may be missing from it.
_CLIENT_LAG_SECONDS = 30
# Tracker replies that mean MAM is refusing the client itself (its IP or passkey), not
# one torrent: "Unrecognized host/PassKey". MAM counts none of its snatches meanwhile.
_ANNOUNCE_REJECTED_RE = re.compile(
    r"passkey|unrecognized\s+host|not\s+authori[sz]ed|unauthori[sz]ed", re.IGNORECASE
)
_client_lock = threading.Lock()


@dataclass(frozen=True)
class _ClientRead:
    """The torrent client's MAM torrents, as read at `read_at`."""

    read_at: float
    name: str | None
    torrents: list[Any] | None  # None when it couldn't be read; `reason` says why
    reason: str | None = None


_client_cache: _ClientRead | None = None


def summarize_unsat_timing(torrents: list[Any], client_name: str | None) -> dict[str, Any]:
    """When the MAM torrents still short of 72 hours' seeding become satisfied.

    Each seeding torrent is satisfied after 72 hours minus the time it has already
    seeded, if it keeps seeding; ones still downloading haven't started that clock.
    """
    remaining = sorted(
        UNSAT_SEED_SECONDS - t.seeding_seconds
        for t in torrents
        if t.complete and t.seeding_seconds < UNSAT_SEED_SECONDS
    )
    return {
        "available": True,
        "client": client_name,
        "next_seconds": remaining[0] if remaining else None,
        "within_window": sum(1 for r in remaining if r <= UNSAT_WINDOW_SECONDS),
        "window_hours": UNSAT_WINDOW_SECONDS // 3600,
        "seeding": len(remaining),
        "downloading": sum(1 for t in torrents if not t.complete),
    }


def _read_client() -> _ClientRead:
    from shelfmark.download.clients import client_label, get_client

    now = time.time()
    try:
        client = get_client("torrent")
    except Exception as exc:  # noqa: BLE001 - each client library raises its own errors
        return _ClientRead(now, None, None, str(exc))
    if client is None:
        return _ClientRead(now, None, None, "No torrent client is configured")
    name = client_label(client)
    try:
        torrents = client.list_tracker_torrents("myanonamouse")
    except Exception as exc:  # noqa: BLE001 - read before every MAM grab: never break one
        logger.warning("Could not read MAM torrents from %s: %s", name, exc)
        return _ClientRead(now, name, None, f"Couldn't read {name}: {exc}")
    if torrents is None:
        return _ClientRead(now, name, None, f"{name} doesn't report seeding time")
    return _ClientRead(now, name, list(torrents))


def _client_torrents(*, refresh: bool = False) -> _ClientRead:
    """The client's MAM torrents, read at most once a minute unless `refresh` is set."""
    global _client_cache
    with _client_lock:
        cached = _client_cache
    if not refresh and cached and time.time() - cached.read_at < _CLIENT_TTL_SECONDS:
        return cached
    read = _read_client()
    with _client_lock:
        _client_cache = read
    return read


def _aged_timing(timing: dict[str, Any], age: float) -> dict[str, Any]:
    """A cached timing as of now: the next slot is `age` seconds closer than when read."""
    next_seconds = timing.get("next_seconds")
    if not isinstance(next_seconds, (int, float)):
        return timing
    # Rounded up, so a slot is never promised early.
    return {**timing, "next_seconds": max(0, math.ceil(next_seconds - age))}


def client_unsat_count(
    *, exclude: set[str] | frozenset[str] = frozenset(), refresh: bool = False
) -> int | None:
    """The unsatisfied torrents MAM will count once it sees what's in the client.

    Every MAM torrent there still downloading or short of 72 hours' seeding, plus
    Shelfmark's snatches handed off since (or just before) the client was read, but
    not those in `exclude`. MAM's own count only moves when the tracker hears from
    the client, so it misses every snatch whose announces are refused; this doesn't.
    None when the client can't say.
    """
    from shelfmark.core.queue import book_queue

    read = _client_torrents(refresh=refresh)
    if read.torrents is None:
        return None
    unsat = sum(
        1 for t in read.torrents if not t.complete or t.seeding_seconds < UNSAT_SEED_SECONDS
    )
    later = [
        task
        for _at, task in book_queue.handoff_times_since(read.read_at - _CLIENT_LAG_SECONDS)
        if task.mam_torrent_id and task.task_id not in exclude
    ]
    return unsat + len(later)


def announce_problem(*, refresh: bool = False) -> str | None:
    """Why MAM isn't hearing from the torrent client, if it's refusing its announces.

    While it is, MAM counts none of the new snatches (and credits no seeding), so its
    unsatisfied count can't be trusted: downloads then wait.
    """
    read = _client_torrents(refresh=refresh)
    rejected = [
        t.tracker_error
        for t in read.torrents or []
        if getattr(t, "tracker_error", None) and _ANNOUNCE_REJECTED_RE.search(t.tracker_error)
    ]
    if not rejected:
        return None
    count = len(rejected)
    return (
        f"MyAnonamouse is rejecting {read.name or 'the torrent client'}'s announces "
        f'({count} torrent{"" if count == 1 else "s"}: "{rejected[0]}"). Check the '
        "client's IP is registered with MAM (mousehole, say); downloads wait until a "
        "re-announce succeeds"
    )


def unsat_timing(*, refresh: bool = False) -> dict[str, Any]:
    """When the next unsatisfied MAM torrent frees a slot, from the torrent client.

    An estimate: MAM keeps its own clock, so time spent paused or offline pushes the
    real moment later. Read at most once a minute. Also says when MAM has frozen
    downloads, and when it's refusing the client's announces: either one comes first.
    """
    from shelfmark.release_sources.prowlarr import mam_freeze

    if not is_configured():
        return {"available": False, "reason": "No MAM session ID is set"}
    read = _client_torrents(refresh=refresh)
    if read.torrents is None:
        timing: dict[str, Any] = {"available": False, "reason": read.reason}
        if read.name:
            timing["client"] = read.name
    else:
        timing = _aged_timing(
            summarize_unsat_timing(read.torrents, read.name), time.time() - read.read_at
        )
    freeze = mam_freeze.current()
    return {
        **timing,
        "frozen_seconds": mam_freeze.remaining_seconds(),
        "frozen_source": freeze["source"] if freeze else None,
        "announce_problem": announce_problem(),
    }


def connection_status() -> dict[str, Any]:
    """Check MAM (a fresh stats read) and the configured torrent client."""
    mam: dict[str, Any]
    if not is_configured():
        mam = {"configured": False, "ok": False, "message": "No MAM session ID is set"}
    else:
        try:
            stats = get_stats(refresh=True)
        except MAM_ERRORS as exc:
            mam = {"configured": True, "ok": False, "message": describe_error(exc)}
        else:
            mam = {
                "configured": True,
                "ok": True,
                "message": f"Connected as {stats.username}" if stats.username else "Connected",
            }
    return {"mam": mam, "torrent_client": _torrent_client_status()}


def buffer_check_enabled() -> bool:
    """Whether MAM downloads larger than the buffer are held back."""
    return bool(config.get("MAM_BLOCK_ON_LOW_BUFFER", True)) and is_configured()


def unsat_check_enabled() -> bool:
    """Whether MAM downloads that would use up the unsatisfied slots are held back."""
    return bool(config.get("MAM_BLOCK_ON_UNSAT_LIMIT", True)) and is_configured()


def unsat_reserve_slots() -> int:
    """Unsatisfied slots to keep free (5 by default)."""
    value = parse_number(config.get("MAM_UNSAT_RESERVE_SLOTS", 5))
    return max(0, int(value)) if value is not None and math.isfinite(value) else 5


def _active_mam_tasks() -> list[tuple[Any, Any]]:
    from shelfmark.core.models import ACTIVE_QUEUE_STATUSES
    from shelfmark.core.queue import book_queue

    return [
        (status, task)
        for status, tasks in book_queue.get_status().items()
        if status in ACTIVE_QUEUE_STATUSES
        for task in tasks.values()
    ]


def pending_charge_bytes() -> int:
    """What Shelfmark's still-active MAM downloads will add to the downloaded total.

    Counted in full: MAM's stats only include what a torrent has downloaded so far,
    so this errs on the side of a smaller buffer.
    """
    return sum(task.mam_charge_bytes or 0 for _status, task in _active_mam_tasks())


def pending_unsat_count(
    stats_fetched_at: float | None = None, unsat_count: int | None = None
) -> int:
    """Shelfmark's MAM torrents that the account's unsatisfied count may not show yet.

    MAM counts a torrent as unsatisfied from when it is snatched, but the stats are read
    at `stats_fetched_at` (and MAM's own figure lags), so this counts the ones not yet
    handed to the torrent client, plus every one handed off since shortly before the
    stats were read, finished or not: a small ebook can finish before MAM's count moves.
    Erring towards counting one twice holds a download back a few minutes; erring the
    other way gets torrents refused at the limit.
    """
    from shelfmark.core.models import QueueStatus
    from shelfmark.core.queue import book_queue

    not_started = {QueueStatus.QUEUED, QueueStatus.RESOLVING}
    counted = {
        task.task_id
        for status, task in _active_mam_tasks()
        if task.mam_torrent_id and status in not_started
    }
    since = (stats_fetched_at if stats_fetched_at is not None else time.time()) - _UNSAT_LAG_SECONDS
    snatched = [
        at
        for at, task in book_queue.handoff_times_since(since)
        if task.mam_torrent_id and task.task_id not in counted
    ]
    pending = len(counted) + _uncounted_snatches(snatched, unsat_count)
    if unsat_count is not None:
        # The client can show more than MAM counts yet (see `client_unsat_count`).
        in_client = client_unsat_count(exclude=counted)
        if in_client is not None:
            pending = max(pending, len(counted) + in_client - unsat_count)
    return pending


def unsat_free_slots(
    *, exclude: set[str] | frozenset[str] = frozenset(), refresh: bool = False
) -> int | None:
    """Unsatisfied slots free right now, below the limit less the slots kept free.

    For a queued download about to be grabbed (or waiting for room). Counts what MAM
    reports plus Shelfmark's torrents snatched since shortly before the stats were read
    (see `pending_unsat_count`), or what's in the torrent client if that's more (see
    `client_unsat_count`), leaving out the tasks in `exclude` (the ones asking).
    None when the check is off, MAM isn't set up or can't be read, or reports no limit.
    """
    from shelfmark.core.queue import book_queue

    if not unsat_check_enabled() or not is_configured():
        return None
    try:
        stats = get_stats(refresh=refresh)
    except MAM_ERRORS as exc:
        logger.debug("Could not read MAM unsatisfied slots: %s", exc)
        return None
    if stats.unsat_count is None or stats.unsat_limit is None:
        return None
    since = stats.fetched_at - _UNSAT_LAG_SECONDS
    snatched = [
        at
        for at, task in book_queue.handoff_times_since(since)
        if task.mam_torrent_id and task.task_id not in exclude
    ]
    used = stats.unsat_count + _uncounted_snatches(snatched, stats.unsat_count)
    in_client = client_unsat_count(exclude=exclude, refresh=refresh)
    if in_client is not None and in_client > used:
        logger.debug("The torrent client has %d unsatisfied, MAM shows %d", in_client, used)
        used = in_client
    return stats.unsat_limit - unsat_reserve_slots() - used


@dataclass(frozen=True)
class GrabAllowance:
    """How many MAM torrents may be grabbed now.

    `free` is None when there's no limit to keep to (the check is off, or MAM reports
    none). `hold` says why none may be, when it's more than the slots being full.
    """

    free: int | None
    hold: str | None = None


def grab_allowance(
    *, exclude: set[str] | frozenset[str] = frozenset(), refresh: bool = False
) -> GrabAllowance:
    """Whether MAM torrents may be grabbed now, and how many.

    Unlike the buffer check before a download is queued, this errs towards waiting:
    a grab MAM refuses at the limit freezes the account's downloads for a day. So
    nothing goes while MAM has frozen downloads, while it can't be read, or while
    it's refusing the client's announces (its count is short of the truth then).
    """
    from shelfmark.release_sources.prowlarr import mam_freeze

    if not unsat_check_enabled():
        return GrabAllowance(None)
    frozen = mam_freeze.remaining_seconds()
    if frozen is not None:
        hours, minutes = frozen // 3600, frozen % 3600 // 60
        return GrabAllowance(
            0,
            "MyAnonamouse has paused downloads on the account (a grab went past the "
            f"unsatisfied limit): waiting {hours} h {minutes:02d} m until it lifts",
        )
    try:
        get_stats(refresh=refresh)
    except MAM_ERRORS as exc:
        return GrabAllowance(
            0, f"Waiting: couldn't read the MyAnonamouse account ({describe_error(exc)})"
        )
    problem = announce_problem(refresh=refresh)
    if problem:
        return GrabAllowance(0, f"Waiting: {problem}")
    return GrabAllowance(unsat_free_slots(exclude=exclude))


def recommended_purchase_gb(missing_bytes: int) -> int:
    """The smallest amount MAM sells that covers `missing_bytes`."""
    missing_gb = max(missing_bytes, 0) / _GIB
    steps = max(1, math.ceil(missing_gb / UPLOAD_CREDIT_STEP_GB))
    return steps * UPLOAD_CREDIT_STEP_GB


@dataclass(frozen=True)
class BufferCheck:
    """Whether some MAM downloads fit in the buffer and the unsatisfied slots.

    `buffer_ok` can be fixed by buying upload credit; `unsat_ok` only by waiting for
    torrents to finish seeding.
    """

    ok: bool
    checked: bool  # False when disabled, or the stats could not be read (never blocks)
    request_bytes: int
    pending_bytes: int = 0
    buffer_bytes: int | None = None
    missing_bytes: int = 0
    recommended_gb: int = 0
    recommended_cost: int = 0
    seedbonus: float | None = None
    error: str | None = None
    buffer_ok: bool = True
    unsat_ok: bool = True
    request_count: int = 0
    unsat_count: int | None = None
    unsat_limit: int | None = None
    unsat_pending: int = 0
    unsat_reserve: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Serialize for the API."""
        return asdict(self)


def check_buffer(releases: list[dict[str, Any]]) -> BufferCheck:
    """Check that `releases` plus the active MAM downloads fit the account.

    Two limits: the buffer (non-freeleech sizes), and the unsatisfied torrent limit less
    the slots to keep free (every MAM torrent). Fails open: when a check is off or MAM
    can't be read, downloads go ahead.
    """
    request_bytes = sum(mam_charge_bytes_for_release(release) for release in releases)
    request_count = sum(1 for release in releases if mam_torrent_id_for_release(release))
    check_buffer_size = request_bytes > 0 and buffer_check_enabled()
    check_unsat = request_count > 0 and unsat_check_enabled()
    if not (check_buffer_size or check_unsat):
        return BufferCheck(
            ok=True, checked=False, request_bytes=request_bytes, request_count=request_count
        )
    try:
        stats = get_stats()
    except MAM_ERRORS as exc:
        logger.warning("Could not check the MAM account, downloading anyway: %s", exc)
        return BufferCheck(
            ok=True,
            checked=False,
            request_bytes=request_bytes,
            request_count=request_count,
            error=describe_error(exc),
        )

    pending = pending_charge_bytes()
    missing = request_bytes + pending - stats.buffer_bytes if check_buffer_size else 0
    recommended = recommended_purchase_gb(missing) if missing > 0 else 0

    unsat_pending = pending_unsat_count(stats.fetched_at, stats.unsat_count)
    reserve = unsat_reserve_slots()
    unsat_ok = True
    if check_unsat and stats.unsat_count is not None and stats.unsat_limit is not None:
        unsat_ok = stats.unsat_count + unsat_pending + request_count <= stats.unsat_limit - reserve

    return BufferCheck(
        ok=missing <= 0 and unsat_ok,
        checked=True,
        request_bytes=request_bytes,
        pending_bytes=pending,
        buffer_bytes=stats.buffer_bytes,
        missing_bytes=max(missing, 0),
        recommended_gb=recommended,
        recommended_cost=recommended * UPLOAD_CREDIT_POINTS_PER_GB,
        seedbonus=stats.seedbonus,
        buffer_ok=missing <= 0,
        unsat_ok=unsat_ok,
        request_count=request_count,
        unsat_count=stats.unsat_count,
        unsat_limit=stats.unsat_limit,
        unsat_pending=unsat_pending,
        unsat_reserve=reserve,
    )


def _flag(value: object) -> bool:
    """MAM sends its yes/no flags as 1/0, as numbers or strings."""
    number = parse_number(value)
    return bool(number) if number is not None else bool(value is True)


def is_vip_class(classname: str | None) -> bool:
    """Whether the account's class gets VIP freeleech: VIP or Elite VIP.

    Kept to the VIP classes, so any doubt means waiting rather than spending buffer.
    """
    return "vip" in (classname or "").lower()


def torrent_is_freeleech(torrent_id: int, *, vip: bool) -> bool:
    """Whether a MAM torrent is freeleech for this account right now.

    Site-wide freeleech, a personal freeleech wedge, or VIP freeleech for a VIP account.
    Raises a MAM error when the torrent can't be read.
    """
    item = _client().get_torrent(torrent_id)
    if item is None:
        msg = f"MyAnonamouse has no torrent {torrent_id}"
        raise MamError(msg)
    return (
        _flag(item.get("free"))
        or _flag(item.get("personal_freeleech"))
        or (vip and _flag(item.get("fl_vip")))
    )


def warning_ratio() -> float:
    """Where the ratio line turns amber: the auto-buy ratio threshold (2.0 by default)."""
    value = parse_number(config.get("MAM_AUTOBUY_RATIO_THRESHOLD", RATIO_WARNING))
    return value if value is not None and math.isfinite(value) else RATIO_WARNING


def keep_ratio() -> float:
    """The ratio to stay at or above: Keep Ratio At Least, or 1.0 (the buffer) when it's off."""
    from shelfmark.core import saved_autoget

    target = saved_autoget.target_ratio()
    return target if target > 0 else 1.0


def ratio_room_bytes(uploaded: int, downloaded: int, ratio: float) -> int:
    """How much more can be downloaded before uploaded / downloaded drops below `ratio`.

    Negative once it already has: then it's how far the downloaded total is over.
    """
    return int(uploaded / ratio) - downloaded if ratio > 0 else uploaded - downloaded


def ratio_snapshot() -> dict[str, Any]:
    """What the projected-ratio line needs; no username or bonus points (all users see it)."""
    if not is_configured():
        return {"available": False}
    try:
        stats = get_stats()
    except MAM_ERRORS as exc:
        return {"available": False, "error": describe_error(exc)}
    pending = pending_charge_bytes()
    keep = keep_ratio()
    return {
        "available": True,
        "uploaded_bytes": stats.uploaded_bytes,
        "downloaded_bytes": stats.downloaded_bytes,
        "ratio": stats.ratio,
        "buffer_bytes": stats.buffer_bytes,
        "pending_bytes": pending,
        "warning_ratio": warning_ratio(),
        "keep_ratio": keep,
        # Room left after Shelfmark's active MAM downloads
        "room_bytes": ratio_room_bytes(
            stats.uploaded_bytes, stats.downloaded_bytes + pending, keep
        ),
        "unsat_count": stats.unsat_count,
        "unsat_limit": stats.unsat_limit,
        "unsat_pending": pending_unsat_count(stats.fetched_at, stats.unsat_count),
        "unsat_reserve": unsat_reserve_slots(),
    }
