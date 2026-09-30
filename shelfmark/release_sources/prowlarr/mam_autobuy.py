"""Buy MyAnonamouse upload credit automatically, as MouseSearch does.

Three independent modes, each off by default:

- ratio: buy when the ratio is below a threshold (MAM's VIP renewal minimum is 2.0);
- buffer: buy when the buffer (uploaded - downloaded) is below a threshold;
- bonus: while bonus points are at or above a threshold, keep buying, spending the
  excess to build buffer.

Ratio and buffer buy at most once per check (buffer only when ratio didn't). The bonus
loop stops when a purchase fails, when the points don't go down, or after
``_MAX_BONUS_PURCHASES``. No purchase ever takes the points below the reserve.

Checks run every ``MAM_AUTOBUY_INTERVAL_HOURS`` from a background thread, and shortly
after a MAM download is queued. Every purchase, manual or automatic, is kept in a small
history file shown in the account panel.
"""

from __future__ import annotations

import json
import math
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any

from shelfmark.config.env import CONFIG_DIR
from shelfmark.core.config import config
from shelfmark.core.logger import setup_logger
from shelfmark.release_sources.prowlarr import mam_account

logger = setup_logger(__name__)

_GIB = 1024**3
_MAX_BONUS_PURCHASES = 20
_HISTORY_LIMIT = 50
_HISTORY_FILE = "mam_purchases.json"
_STARTUP_DELAY_SECONDS = 60
_AFTER_QUEUE_DELAY_SECONDS = 20


@dataclass(frozen=True)
class AutoBuySettings:
    """The auto-buy settings, read fresh for every check."""

    ratio_enabled: bool
    ratio_threshold: float
    ratio_amount: int
    buffer_enabled: bool
    buffer_threshold_gb: float
    buffer_amount: int
    bonus_enabled: bool
    bonus_threshold: float
    bonus_amount: int
    reserve_points: float
    interval_hours: float

    @property
    def any_enabled(self) -> bool:
        """Whether any mode is on."""
        return self.ratio_enabled or self.buffer_enabled or self.bonus_enabled


def _number(key: str, default: float) -> float:
    number = mam_account.parse_number(config.get(key, default))
    return number if number is not None and math.isfinite(number) else default


def _amount(key: str) -> int:
    """A purchase size setting, rounded down to MAM's 50 GB steps (at least one)."""
    step = mam_account.UPLOAD_CREDIT_STEP_GB
    return max(step, int(_number(key, step)) // step * step)


def load_settings() -> AutoBuySettings:
    """Read the auto-buy settings."""
    return AutoBuySettings(
        ratio_enabled=bool(config.get("MAM_AUTOBUY_RATIO_ENABLED", False)),
        ratio_threshold=_number("MAM_AUTOBUY_RATIO_THRESHOLD", 2.0),
        ratio_amount=_amount("MAM_AUTOBUY_RATIO_AMOUNT"),
        buffer_enabled=bool(config.get("MAM_AUTOBUY_BUFFER_ENABLED", False)),
        buffer_threshold_gb=_number("MAM_AUTOBUY_BUFFER_THRESHOLD_GB", 10.0),
        buffer_amount=_amount("MAM_AUTOBUY_BUFFER_AMOUNT"),
        bonus_enabled=bool(config.get("MAM_AUTOBUY_BONUS_ENABLED", False)),
        bonus_threshold=_number("MAM_AUTOBUY_BONUS_THRESHOLD", 50000.0),
        bonus_amount=_amount("MAM_AUTOBUY_BONUS_AMOUNT"),
        reserve_points=max(0.0, _number("MAM_AUTOBUY_RESERVE_POINTS", 0.0)),
        interval_hours=max(1.0, _number("MAM_AUTOBUY_INTERVAL_HOURS", 6.0)),
    )


# --- Purchase history -------------------------------------------------------------


@dataclass(frozen=True)
class PurchaseRecord:
    """One purchase, kept for the account panel."""

    at: float
    reason: str  # manual, ratio, buffer, bonus, download
    requested: str  # "100" or "max"
    amount_gb: float
    success: bool
    seedbonus: float | None = None
    error: str | None = None


_history_lock = threading.Lock()


def _history_path() -> Any:
    return CONFIG_DIR / _HISTORY_FILE


def load_history() -> list[dict[str, Any]]:
    """Recent purchases, newest first."""
    with _history_lock:
        try:
            data = json.loads(_history_path().read_text(encoding="utf-8"))
        except OSError, ValueError:
            return []
    return data if isinstance(data, list) else []


def record_purchase(reason: str, requested: int | str, result: mam_account.PurchaseResult) -> None:
    """Add a purchase to the history file (best effort)."""
    record = PurchaseRecord(
        at=time.time(),
        reason=reason,
        requested=str(requested),
        amount_gb=result.amount_gb,
        success=result.success,
        seedbonus=result.seedbonus,
        error=result.error,
    )
    history = [asdict(record), *load_history()][:_HISTORY_LIMIT]
    with _history_lock:
        try:
            _history_path().write_text(json.dumps(history), encoding="utf-8")
        except OSError as exc:
            logger.warning("Could not save MAM purchase history: %s", exc)


def buy(amount: int | str, *, reason: str) -> mam_account.PurchaseResult:
    """Buy upload credit and record it in the history."""
    result = mam_account.purchase_upload_credit(amount, reason=reason)
    record_purchase(reason, amount, result)
    return result


# --- Checks -----------------------------------------------------------------------


@dataclass
class CheckReport:
    """What one auto-buy check saw and did."""

    at: float = field(default_factory=time.time)
    trigger: str = "schedule"
    skipped: str | None = None
    ratio: float | None = None
    buffer_gb: float | None = None
    seedbonus: float | None = None
    purchases: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialize for the API."""
        return asdict(self)


_check_lock = threading.Lock()
_last_report: CheckReport | None = None


def last_report() -> dict[str, Any] | None:
    """The most recent check's report."""
    return _last_report.to_dict() if _last_report else None


def _affordable(seedbonus: float, amount: int, reserve: float) -> bool:
    return seedbonus - amount * mam_account.UPLOAD_CREDIT_POINTS_PER_GB >= reserve


def _purchase(report: CheckReport, amount: int, reason: str) -> mam_account.PurchaseResult:
    result = buy(amount, reason=reason)
    report.purchases.append(
        {
            "reason": reason,
            "amount_gb": result.amount_gb,
            "success": result.success,
            "error": result.error,
        }
    )
    return result


def _run_modes(report: CheckReport, settings: AutoBuySettings, stats: mam_account.MamStats) -> None:
    seedbonus = stats.seedbonus
    reserve = settings.reserve_points
    bought = False

    ratio = stats.ratio
    if settings.ratio_enabled and ratio is not None and ratio < settings.ratio_threshold:
        if _affordable(seedbonus, settings.ratio_amount, reserve):
            result = _purchase(report, settings.ratio_amount, "ratio")
            bought = result.amount_gb > 0
            if result.seedbonus is not None:
                seedbonus = result.seedbonus
        else:
            report.notes.append(
                f"Ratio {ratio:.2f} is below {settings.ratio_threshold}, but "
                f"{settings.ratio_amount} GB would take the points below the reserve"
            )

    buffer_gb = stats.buffer_bytes / _GIB
    if settings.buffer_enabled and not bought and buffer_gb < settings.buffer_threshold_gb:
        if _affordable(seedbonus, settings.buffer_amount, reserve):
            result = _purchase(report, settings.buffer_amount, "buffer")
            if result.seedbonus is not None:
                seedbonus = result.seedbonus
        else:
            report.notes.append(
                f"Buffer {buffer_gb:.1f} GB is below {settings.buffer_threshold_gb:g} GB, but "
                f"{settings.buffer_amount} GB would take the points below the reserve"
            )

    if not settings.bonus_enabled:
        return
    for _ in range(_MAX_BONUS_PURCHASES):
        if seedbonus < settings.bonus_threshold or not _affordable(
            seedbonus, settings.bonus_amount, reserve
        ):
            return
        result = _purchase(report, settings.bonus_amount, "bonus")
        if not result.success:
            return
        remaining = result.seedbonus
        if remaining is None:
            remaining = mam_account.get_stats(refresh=True).seedbonus
        if remaining >= seedbonus:
            report.notes.append("Bonus points did not go down after a purchase; stopped")
            return
        seedbonus = remaining
    report.notes.append(f"Stopped after {_MAX_BONUS_PURCHASES} bonus purchases in one check")


def run_check(trigger: str = "schedule") -> CheckReport:
    """Check the account and buy upload credit where a mode calls for it.

    Only one check runs at a time; a second caller gets a skipped report.
    """
    global _last_report
    report = CheckReport(trigger=trigger)
    if not _check_lock.acquire(blocking=False):
        report.skipped = "Another check is already running"
        return report
    try:
        settings = load_settings()
        if not mam_account.is_configured():
            report.skipped = "No MAM session ID is set"
        elif not settings.any_enabled:
            report.skipped = "No auto-buy mode is on"
        else:
            try:
                stats = mam_account.get_stats(refresh=True)
            except mam_account.MAM_ERRORS as exc:
                report.skipped = mam_account.describe_error(exc)
            else:
                report.ratio = stats.ratio
                report.buffer_gb = round(stats.buffer_bytes / _GIB, 2)
                report.seedbonus = stats.seedbonus
                try:
                    _run_modes(report, settings, stats)
                except mam_account.MAM_ERRORS as exc:
                    report.notes.append(mam_account.describe_error(exc))
        if report.skipped:
            logger.debug("MAM auto-buy check (%s) skipped: %s", trigger, report.skipped)
        elif report.purchases:
            logger.info("MAM auto-buy check (%s): %s", trigger, report.purchases)
        _last_report = report
        return report
    finally:
        _check_lock.release()


# --- Scheduling -------------------------------------------------------------------

_wake = threading.Event()
_thread: threading.Thread | None = None
_thread_lock = threading.Lock()
_pending_timer: threading.Timer | None = None


def _loop() -> None:
    delay = _STARTUP_DELAY_SECONDS
    while True:
        _wake.wait(delay)
        _wake.clear()
        try:
            run_check("schedule")
        except Exception:  # the scheduler must outlive any one check
            logger.exception("MAM auto-buy check failed")
        delay = load_settings().interval_hours * 3600


def start() -> None:
    """Start the background scheduler (idempotent)."""
    global _thread
    with _thread_lock:
        if _thread is not None and _thread.is_alive():
            return
        _thread = threading.Thread(target=_loop, name="mam-autobuy", daemon=True)
        _thread.start()


def check_soon(trigger: str = "download") -> None:
    """Run a check shortly (debounced): after a MAM download is queued."""
    global _pending_timer
    if not mam_account.is_configured() or not load_settings().any_enabled:
        return
    with _thread_lock:
        if _pending_timer is not None and _pending_timer.is_alive():
            return

        def _run() -> None:
            try:
                run_check(trigger)
            except Exception:  # a background check must not raise
                logger.exception("MAM auto-buy check failed")

        _pending_timer = threading.Timer(_AFTER_QUEUE_DELAY_SECONDS, _run)
        _pending_timer.daemon = True
        _pending_timer.start()
