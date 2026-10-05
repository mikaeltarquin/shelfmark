"""MyAnonamouse's download freeze: after a grab past the unsatisfied limit, MAM refuses
every download for about a day ("Attempted to Download Past Unsatisfied limit ... Time
Till Download Allowed: 1d 02:04:02").

Read from a refused torrent download when MAM's reply says so, or entered by hand from
the site. Kept in a file so a restart doesn't forget it: grabbing during the freeze only
gets refused again.
"""

from __future__ import annotations

import json
import re
import threading
import time
from typing import Any

from shelfmark.config.env import CONFIG_DIR
from shelfmark.core.logger import setup_logger

logger = setup_logger(__name__)

_FREEZE_FILE = "mam_freeze.json"
# When MAM says it's frozen but not for how long: its freeze is a day.
DEFAULT_FREEZE_SECONDS = 24 * 3600
# Longer than any freeze MAM hands out; guards against a misread.
_MAX_FREEZE_SECONDS = 7 * 24 * 3600

_LIMIT_RE = re.compile(r"past\s+unsatisfied\s+limit", re.IGNORECASE)
# "1d 02:04:02", "2 days 1:00:00" or "23:59:59", after the label. The label and value
# can be split by markup (HTML cells, or escaped HTML in a proxy's JSON error).
_DURATION = r"(?:(\d+)\s*d\w*\s*)?(\d{1,2}):(\d{2}):(\d{2})"
_REMAINING_RE = re.compile(
    r"Time\s+Till\s+Download\s+Allowed.{0,80}?" + _DURATION, re.IGNORECASE | re.DOTALL
)
_DURATION_RE = re.compile(r"^\s*" + _DURATION + r"\s*$", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]*>")

_lock = threading.Lock()


def _path() -> Any:
    return CONFIG_DIR / _FREEZE_FILE


def _seconds(match: re.Match[str]) -> int:
    days, hours, minutes, seconds = (int(g) if g else 0 for g in match.groups())
    return ((days * 24 + hours) * 60 + minutes) * 60 + seconds


def parse_duration(text: str) -> int | None:
    """Seconds in a remaining time as MAM shows it ("1d 02:04:02"), or None."""
    match = _DURATION_RE.match(text or "")
    return _seconds(match) if match else None


def parse_refusal(text: str) -> int | None:
    """How long MAM's download freeze lasts, from a refused download's reply.

    None when the reply isn't a freeze; a day when it is but gives no time.
    """
    if not text:
        return None
    plain = _TAG_RE.sub(" ", text)
    match = _REMAINING_RE.search(plain)
    if match:
        return _seconds(match)
    return DEFAULT_FREEZE_SECONDS if _LIMIT_RE.search(plain) else None


def _load() -> dict[str, Any] | None:
    with _lock:
        try:
            data = json.loads(_path().read_text(encoding="utf-8"))
        except OSError, ValueError:
            return None
    if not isinstance(data, dict) or not isinstance(data.get("until"), (int, float)):
        return None
    return data


def current() -> dict[str, Any] | None:
    """The freeze in force now: {"until", "source"}, or None."""
    data = _load()
    if data is None or data["until"] <= time.time():
        return None
    return {"until": float(data["until"]), "source": str(data.get("source") or "detected")}


def remaining_seconds() -> int | None:
    """Seconds until MAM allows downloads again, or None when it isn't frozen."""
    freeze = current()
    return max(0, int(freeze["until"] - time.time())) if freeze else None


def set_freeze(seconds: float, *, source: str) -> float:
    """Record a freeze lasting `seconds` from now; returns when it ends."""
    seconds = min(max(float(seconds), 0.0), _MAX_FREEZE_SECONDS)
    until = time.time() + seconds
    with _lock:
        try:
            _path().write_text(json.dumps({"until": until, "source": source}), encoding="utf-8")
        except OSError as exc:
            logger.warning("Could not save the MAM download freeze: %s", exc)
    return until


def clear() -> None:
    """Forget the freeze (MAM lifted it, or it was entered by mistake)."""
    with _lock:
        try:
            _path().unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("Could not clear the MAM download freeze: %s", exc)


def note_refusal(text: str) -> bool:
    """Record a freeze if a refused download's reply is MAM's; whether it was."""
    seconds = parse_refusal(text)
    if seconds is None:
        return False
    set_freeze(seconds, source="detected")
    logger.warning(
        "MyAnonamouse has frozen downloads for the unsatisfied limit: holding MAM "
        "downloads for %d h %02d m",
        seconds // 3600,
        seconds % 3600 // 60,
    )
    return True
