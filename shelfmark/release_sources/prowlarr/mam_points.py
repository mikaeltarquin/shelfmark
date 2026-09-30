"""Estimate the MyAnonamouse bonus points earning rate.

MAM's API has no earning rate, only the current balance. Shelfmark records the balance
over time (on every fresh stats read, and hourly in the background) and estimates what
was earned between readings, whatever was spent:

- points Shelfmark spent on upload credit (from its purchase history) are added back, so
  a period with a purchase still counts;
- a period where points still went down after that was spent elsewhere (on MAM's site),
  which hides what was earned, so it is left out;
- a period that ends at MAM's 99,999 cap is left out, since earnings past the cap are lost.

Leaving whole periods out keeps the estimate unbiased: both what was earned and the time
it took drop out together.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any

from shelfmark.config.env import CONFIG_DIR
from shelfmark.core.logger import setup_logger

logger = setup_logger(__name__)

POINTS_CAP = 99_999
_SAMPLES_FILE = "mam_points.json"
_KEEP_SECONDS = 48 * 3600
_WINDOW_SECONDS = 24 * 3600
_MIN_SAMPLE_GAP_SECONDS = 10 * 60
_MIN_COVERED_SECONDS = 2 * 3600  # Less than this is too noisy to show
_SAMPLE_INTERVAL_SECONDS = 3600

_lock = threading.Lock()


def _path() -> Any:
    return CONFIG_DIR / _SAMPLES_FILE


def load_samples() -> list[tuple[float, float]]:
    """Recorded (timestamp, balance) pairs, oldest first."""
    with _lock:
        try:
            data = json.loads(_path().read_text(encoding="utf-8"))
        except OSError, ValueError:
            return []
    if not isinstance(data, list):
        return []
    samples = [
        (float(entry[0]), float(entry[1]))
        for entry in data
        if isinstance(entry, list)
        and len(entry) == 2
        and all(isinstance(v, (int, float)) for v in entry)
    ]
    return sorted(samples)


def record_sample(seedbonus: float, at: float | None = None) -> None:
    """Record a balance reading; readings closer than 10 minutes apart are skipped."""
    now = time.time() if at is None else at
    samples = load_samples()
    if samples and now - samples[-1][0] < _MIN_SAMPLE_GAP_SECONDS:
        return
    samples = [s for s in samples if now - s[0] <= _KEEP_SECONDS]
    samples.append((now, float(seedbonus)))
    with _lock:
        try:
            _path().write_text(json.dumps([list(s) for s in samples]), encoding="utf-8")
        except OSError as exc:
            logger.debug("Could not save MAM points samples: %s", exc)


def shelfmark_spending() -> list[tuple[float, float]]:
    """(timestamp, points) Shelfmark spent on upload credit, from its purchase history."""
    from shelfmark.release_sources.prowlarr.mam_account import UPLOAD_CREDIT_POINTS_PER_GB
    from shelfmark.release_sources.prowlarr.mam_autobuy import load_history

    spent: list[tuple[float, float]] = []
    for entry in load_history():
        at, amount = entry.get("at"), entry.get("amount_gb")
        if isinstance(at, (int, float)) and isinstance(amount, (int, float)) and amount > 0:
            spent.append((float(at), float(amount) * UPLOAD_CREDIT_POINTS_PER_GB))
    return spent


def estimate_rate(
    samples: list[tuple[float, float]] | None = None,
    now: float | None = None,
    spending: list[tuple[float, float]] | None = None,
) -> dict[str, float] | None:
    """Estimated points earned per hour over the last 24 hours, or None with too little data.

    Returns ``{"per_hour": ..., "hours": ...}``; ``hours`` is how much time the estimate
    rests on. `spending` is (timestamp, points) Shelfmark spent, added back per period.
    """
    now = time.time() if now is None else now
    recent = [
        s
        for s in (samples if samples is not None else load_samples())
        if now - s[0] <= _WINDOW_SECONDS
    ]
    spent_log = spending if spending is not None else shelfmark_spending()
    earned = 0.0
    covered = 0.0
    for (start_at, start_points), (end_at, end_points) in zip(recent, recent[1:], strict=False):
        spent = sum(points for at, points in spent_log if start_at < at <= end_at)
        delta = end_points - start_points + spent
        if delta < 0 or end_points >= POINTS_CAP:
            continue
        earned += delta
        covered += end_at - start_at
    if covered < _MIN_COVERED_SECONDS:
        return None
    return {"per_hour": earned / (covered / 3600), "hours": covered / 3600}


_thread: threading.Thread | None = None
_thread_lock = threading.Lock()


def _loop() -> None:
    from shelfmark.release_sources.prowlarr import mam_account

    while True:
        time.sleep(_SAMPLE_INTERVAL_SECONDS)
        if not mam_account.is_configured():
            continue
        try:
            mam_account.get_stats(refresh=True)  # records a sample
        except mam_account.MAM_ERRORS as exc:
            logger.debug("MAM points sample skipped: %s", exc)
        except Exception:  # the sampler must outlive any one failure
            logger.exception("MAM points sample failed")


def start() -> None:
    """Start hourly balance sampling in the background (idempotent)."""
    global _thread
    with _thread_lock:
        if _thread is not None and _thread.is_alive():
            return
        _thread = threading.Thread(target=_loop, name="mam-points", daemon=True)
        _thread.start()
