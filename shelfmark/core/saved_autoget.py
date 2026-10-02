"""Get saved items automatically once there is room.

A saved item with picked releases can be marked "get automatically". A background check
(every ``SAVED_AUTO_GET_INTERVAL_MINUTES``, and shortly after an item is marked) queues
it once all of these hold:

- the owner may download those releases directly (no approval needed);
- MyAnonamouse torrents fit the buffer and the unsatisfied limit, the same check as a
  manual download, except that it never buys upload credit and waits when MAM can't be
  read;
- the ratio stays healthy, by one rule for every item rather than per-item settings:
  freeleech torrents (checked live on MAM) never touch the ratio, so they go as soon as
  there is room; anything else goes when the ratio afterwards is still at the target
  (``SAVED_AUTO_GET_TARGET_RATIO``), or when it is small enough to barely move the ratio
  (an ebook, say). The rest waits until the ratio recovers or the torrent turns
  freeleech, whichever comes first.

Items wait in order of saving, so earlier ones get the free slots first. Every check
records why an item is still waiting, shown in the Saved tab.
"""

from __future__ import annotations

import copy
import math
import threading
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from shelfmark.core.config import config
from shelfmark.core.logger import setup_logger
from shelfmark.release_sources.prowlarr import mam_account
from shelfmark.release_sources.prowlarr.mam_charge import (
    mam_charge_bytes_for_release,
    mam_torrent_id_for_release,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from shelfmark.core.saved_items import SavedItemsService

logger = setup_logger(__name__)

_GIB = 1024**3
_DEFAULT_INTERVAL_MINUTES = 10
_MIN_INTERVAL_MINUTES = 5
_STARTUP_DELAY_SECONDS = 90
_SOON_DELAY_SECONDS = 5
_DEFAULT_TARGET_RATIO = 2.0
# A download that lowers the ratio by less than this goes even below the target.
SMALL_RATIO_DROP = 0.01


@dataclass(frozen=True)
class Owner:
    """Who a saved item belongs to, as the download queue needs it."""

    user_id: int | None
    username: str | None


@dataclass(frozen=True)
class AutoGetHooks:
    """What the check needs from the app: users, policy, the queue and notifications."""

    # None when the owner no longer exists.
    resolve_owner: Callable[[str], Owner | None]
    # Whether the owner may download this release directly, without a request.
    may_download: Callable[[Owner, dict[str, Any]], bool]
    queue_release: Callable[[dict[str, Any], Owner], tuple[bool, str | None]]
    notify: Callable[[dict[str, Any], Owner], None]


@dataclass
class Decision:
    """Whether an item can be got now; if not, why it waits."""

    ready: bool
    status: str = ""
    payloads: list[dict[str, Any]] = field(default_factory=list)


def enabled() -> bool:
    """The global switch for automatic downloads (on by default)."""
    return bool(config.get("SAVED_AUTO_GET_ENABLED", True))


def interval_minutes() -> float:
    """Minutes between checks; at least 5, so MAM isn't asked too often."""
    value = mam_account.parse_number(
        config.get("SAVED_AUTO_GET_INTERVAL_MINUTES", _DEFAULT_INTERVAL_MINUTES)
    )
    if value is None or not math.isfinite(value):
        value = _DEFAULT_INTERVAL_MINUTES
    return max(float(_MIN_INTERVAL_MINUTES), value)


def target_ratio() -> float:
    """The ratio non-freeleech automatic downloads keep (0 turns the check off)."""
    value = mam_account.parse_number(
        config.get("SAVED_AUTO_GET_TARGET_RATIO", _DEFAULT_TARGET_RATIO)
    )
    if value is None or not math.isfinite(value) or value < 0:
        return _DEFAULT_TARGET_RATIO
    return value


def _gib(value: int) -> str:
    return f"{value / _GIB:.2f} GB"


def _size(value: int) -> str:
    return _gib(value) if value >= _GIB else f"{value / 1024**2:.0f} MB"


def _ratio(uploaded: int, downloaded: int) -> float:
    return uploaded / downloaded if downloaded > 0 else math.inf


def _ratio_wait(stats: mam_account.MamStats, charge: int) -> str | None:
    """Why a non-freeleech download should wait for the ratio, or None when it may go."""
    target = target_ratio()
    if charge <= 0 or target <= 0:
        return None
    downloaded = stats.downloaded_bytes + mam_account.pending_charge_bytes()
    before = _ratio(stats.uploaded_bytes, downloaded)
    after = _ratio(stats.uploaded_bytes, downloaded + charge)
    if after >= target or before - after < SMALL_RATIO_DROP:
        return None
    return (
        f"Waiting for freeleech or ratio {target:.2f}: {_size(charge)} would take it "
        f"from {before:.2f} to {after:.2f}"
    )


class _RunContext:
    """MAM account stats, read once per check run."""

    def __init__(self) -> None:
        self._stats: mam_account.MamStats | None = None
        self._error: str | None = None
        self._read = False

    def stats(self) -> tuple[mam_account.MamStats | None, str | None]:
        if not self._read:
            self._read = True
            try:
                self._stats = mam_account.get_stats(refresh=True)
            except mam_account.MAM_ERRORS as exc:
                self._error = mam_account.describe_error(exc)
        return self._stats, self._error


def _with_freeleech(payload: dict[str, Any], freeleech: bool) -> dict[str, Any]:
    updated = copy.deepcopy(payload)
    extra = updated.get("extra")
    extra = dict(extra) if isinstance(extra, dict) else {}
    extra["freeleech"] = freeleech
    updated["extra"] = extra
    return updated


def _unsat_wait(check: mam_account.BufferCheck) -> str:
    if check.unsat_count is None or check.unsat_limit is None:
        return "Waiting for unsatisfied slots"
    needed = (check.unsat_count + check.unsat_pending + check.request_count) - (
        check.unsat_limit - check.unsat_reserve
    )
    needed = max(needed, 1)
    return f"Waiting for {needed} unsatisfied slot{'s' if needed != 1 else ''}"


def evaluate(item: dict[str, Any], owner: Owner, hooks: AutoGetHooks, run: _RunContext) -> Decision:
    """Decide whether one saved item can be downloaded now."""
    releases = item.get("releases") or []
    payloads = [p for p in item.get("payloads") or [] if isinstance(p, dict)]
    if not payloads or len(payloads) != len(releases):
        return Decision(False, "Save the pick again to download it automatically")
    if not all(hooks.may_download(owner, payload) for payload in payloads):
        return Decision(False, "Needs approval: use Get to request it")

    mam_indexes = [i for i, p in enumerate(payloads) if mam_torrent_id_for_release(p)]
    if not mam_indexes:
        # Nothing here counts against MyAnonamouse, so nothing to wait for.
        return Decision(True, payloads=payloads)
    if not mam_account.is_configured():
        return Decision(True, payloads=payloads)

    stats, error = run.stats()
    if stats is None:
        return Decision(False, f"Couldn't read the MyAnonamouse account: {error}")

    # Freeleech can start or end at any time, so ask MAM rather than trusting the save.
    vip = mam_account.is_vip_class(stats.classname)
    for index in mam_indexes:
        torrent_id = mam_torrent_id_for_release(payloads[index])
        if torrent_id is None:
            continue
        try:
            freeleech = mam_account.torrent_is_freeleech(torrent_id, vip=vip)
        except mam_account.MAM_ERRORS:
            continue  # Keep what the search said; the ratio check covers a wrong guess
        payloads[index] = _with_freeleech(payloads[index], freeleech)

    check = mam_account.check_buffer(payloads)
    if not check.ok:
        if not check.unsat_ok:
            return Decision(False, _unsat_wait(check))
        return Decision(False, f"Waiting for buffer: {_gib(check.missing_bytes)} short")
    if not check.checked and check.error:
        return Decision(False, f"Couldn't check MyAnonamouse: {check.error}")

    wait = _ratio_wait(stats, sum(mam_charge_bytes_for_release(p) for p in payloads))
    if wait:
        return Decision(False, wait)

    return Decision(True, payloads=payloads)


@dataclass
class RunReport:
    """What one check did, for logs and tests."""

    checked: int = 0
    queued: list[int] = field(default_factory=list)
    waiting: dict[int, str] = field(default_factory=dict)


class SavedAutoGetter:
    """Runs the checks and the background schedule."""

    def __init__(self, service: SavedItemsService, hooks: AutoGetHooks) -> None:
        """Check the items in `service`, acting through `hooks`."""
        self._service = service
        self._hooks = hooks
        self._run_lock = threading.Lock()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None
        self._thread_lock = threading.Lock()
        self._soon: threading.Timer | None = None

    def run_check(self) -> RunReport:
        """Check every item marked for automatic download, oldest first."""
        report = RunReport()
        if not enabled() or not self._run_lock.acquire(blocking=False):
            return report
        try:
            run = _RunContext()
            for item in self._service.list_auto_items():
                report.checked += 1
                try:
                    self._check_item(item, run, report)
                except Exception:  # one bad item must not stop the rest
                    logger.exception("Saved item %s: automatic download check failed", item["id"])
            if report.queued:
                logger.info("Saved items downloaded automatically: %s", report.queued)
            return report
        finally:
            self._run_lock.release()

    def _check_item(self, item: dict[str, Any], run: _RunContext, report: RunReport) -> None:
        owner_key = item["owner"]
        owner = self._hooks.resolve_owner(owner_key)
        if owner is None:
            return
        decision = evaluate(item, owner, self._hooks, run)
        if not decision.ready:
            report.waiting[item["id"]] = decision.status
            self._service.update(owner_key, item["id"], auto_status=decision.status)
            return

        failed: list[tuple[dict[str, Any], dict[str, Any], str]] = []
        releases = item.get("releases") or []
        for pick, payload in zip(releases, decision.payloads, strict=True):
            ok, error = self._hooks.queue_release(payload, owner)
            if not ok:
                failed.append((pick, payload, error or "Could not queue the download"))
        if len(failed) == len(decision.payloads):
            error = failed[0][2]
            report.waiting[item["id"]] = error
            self._service.update(owner_key, item["id"], auto_status=f"Couldn't queue: {error}")
            return
        report.queued.append(item["id"])
        if failed:
            self._service.keep_picks(
                owner_key,
                item["id"],
                releases=[pick for pick, _, _ in failed],
                payloads=[payload for _, payload, _ in failed],
                last_error=f"Some picks couldn't be queued: {failed[0][2]}",
            )
        else:
            self._service.delete(owner_key, item["id"])
        try:
            self._hooks.notify(item, owner)
        except Exception:  # a notification failure must not undo the download
            logger.exception("Saved item %s: notification failed", item["id"])

    # --- Scheduling ---------------------------------------------------------------

    def _loop(self) -> None:
        delay: float = _STARTUP_DELAY_SECONDS
        while True:
            self._wake.wait(delay)
            self._wake.clear()
            try:
                self.run_check()
            except Exception:  # the scheduler must outlive any one check
                logger.exception("Saved items automatic download check failed")
            delay = interval_minutes() * 60

    def start(self) -> None:
        """Start the background schedule (idempotent)."""
        with self._thread_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._loop, name="saved-autoget", daemon=True)
            self._thread.start()

    def check_soon(self) -> None:
        """Run a check in a few seconds (debounced): after an item is marked."""
        if not enabled():
            return
        with self._thread_lock:
            if self._soon is not None and self._soon.is_alive():
                return
            self._soon = threading.Timer(_SOON_DELAY_SECONDS, self._run_soon)
            self._soon.daemon = True
            self._soon.start()

    def _run_soon(self) -> None:
        try:
            self.run_check()
        except Exception:  # a background check must not raise
            logger.exception("Saved items automatic download check failed")
