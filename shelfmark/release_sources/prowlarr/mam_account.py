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
from shelfmark.release_sources.prowlarr.mam_charge import mam_charge_bytes_for_release

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


def _parse_float(value: object) -> float | None:
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


def parse_stats(data: dict[str, Any]) -> MamStats:
    """Build MamStats from a jsonLoad.php reply, preferring its exact byte counts."""
    uploaded = parse_size_bytes(data.get("uploaded_bytes"))
    if uploaded is None:
        uploaded = parse_size_bytes(data.get("uploaded")) or 0
    downloaded = parse_size_bytes(data.get("downloaded_bytes"))
    if downloaded is None:
        downloaded = parse_size_bytes(data.get("downloaded")) or 0
    username = data.get("username")
    classname = data.get("classname")
    vip_until = data.get("vip_until")
    return MamStats(
        username=str(username) if username else None,
        classname=str(classname) if classname else None,
        uploaded_bytes=uploaded,
        downloaded_bytes=downloaded,
        ratio=_parse_float(data.get("ratio")),
        seedbonus=_parse_float(data.get("seedbonus")) or 0.0,
        vip_until=str(vip_until) if vip_until else None,
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
    return stats


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
    number = _parse_float(value)  # None for booleans too
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
    seedbonus = _parse_float(reply.get("seedbonus"))
    if not reply.get("success"):
        return False, 0.0, seedbonus, _store_error(reply)
    bought = _parse_float(reply.get("amount"))
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


_CLIENT_LABELS = {
    "qbittorrent": "qBittorrent",
    "transmission": "Transmission",
    "deluge": "Deluge",
    "rtorrent": "rTorrent",
    "blackhole": "Blackhole folder",
    "realdebrid": "Real-Debrid",
    "alldebrid": "AllDebrid",
    "torbox": "TorBox",
}


def _torrent_client_status() -> dict[str, Any]:
    from shelfmark.download.clients import get_client

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
    raw_name = str(getattr(client, "name", "") or "")
    name = _CLIENT_LABELS.get(raw_name, raw_name.title() or None)
    try:
        ok, message = client.test_connection()
    except (OSError, RuntimeError, ValueError, requests.exceptions.RequestException) as exc:
        ok, message = False, str(exc)
    return {"configured": True, "ok": bool(ok), "name": name, "message": message}


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


def pending_charge_bytes() -> int:
    """What Shelfmark's still-active MAM downloads will add to the downloaded total.

    Counted in full: MAM's stats only include what a torrent has downloaded so far,
    so this errs on the side of a smaller buffer.
    """
    from shelfmark.core.models import ACTIVE_QUEUE_STATUSES
    from shelfmark.core.queue import book_queue

    total = 0
    for status, tasks in book_queue.get_status().items():
        if status not in ACTIVE_QUEUE_STATUSES:
            continue
        total += sum(task.mam_charge_bytes or 0 for task in tasks.values())
    return total


def recommended_purchase_gb(missing_bytes: int) -> int:
    """The smallest amount MAM sells that covers `missing_bytes`."""
    missing_gb = max(missing_bytes, 0) / _GIB
    steps = max(1, math.ceil(missing_gb / UPLOAD_CREDIT_STEP_GB))
    return steps * UPLOAD_CREDIT_STEP_GB


@dataclass(frozen=True)
class BufferCheck:
    """Whether some MAM downloads fit in the buffer, and what to buy if not."""

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

    def to_dict(self) -> dict[str, Any]:
        """Serialize for the API."""
        return asdict(self)


def check_buffer(releases: list[dict[str, Any]]) -> BufferCheck:
    """Check that `releases` plus the active MAM downloads fit in the account's buffer.

    Fails open: when the check is off or MAM can't be read, downloads go ahead.
    """
    request_bytes = sum(mam_charge_bytes_for_release(release) for release in releases)
    if request_bytes <= 0 or not buffer_check_enabled():
        return BufferCheck(ok=True, checked=False, request_bytes=request_bytes)
    try:
        stats = get_stats()
    except MAM_ERRORS as exc:
        logger.warning("Could not check the MAM buffer, downloading anyway: %s", exc)
        return BufferCheck(
            ok=True, checked=False, request_bytes=request_bytes, error=describe_error(exc)
        )
    pending = pending_charge_bytes()
    missing = request_bytes + pending - stats.buffer_bytes
    recommended = recommended_purchase_gb(missing) if missing > 0 else 0
    return BufferCheck(
        ok=missing <= 0,
        checked=True,
        request_bytes=request_bytes,
        pending_bytes=pending,
        buffer_bytes=stats.buffer_bytes,
        missing_bytes=max(missing, 0),
        recommended_gb=recommended,
        recommended_cost=recommended * UPLOAD_CREDIT_POINTS_PER_GB,
        seedbonus=stats.seedbonus,
    )


def ratio_snapshot() -> dict[str, Any]:
    """What the projected-ratio line needs; no username or bonus points (all users see it)."""
    if not is_configured():
        return {"available": False}
    try:
        stats = get_stats()
    except MAM_ERRORS as exc:
        return {"available": False, "error": describe_error(exc)}
    return {
        "available": True,
        "uploaded_bytes": stats.uploaded_bytes,
        "downloaded_bytes": stats.downloaded_bytes,
        "ratio": stats.ratio,
        "buffer_bytes": stats.buffer_bytes,
        "pending_bytes": pending_charge_bytes(),
        "warning_ratio": RATIO_WARNING,
    }
