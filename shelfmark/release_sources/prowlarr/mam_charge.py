"""How much a release adds to the MyAnonamouse account's downloaded total.

Kept free of other Shelfmark imports: the download orchestrator uses it when queueing.
"""

from __future__ import annotations

from typing import Any


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float):
        return int(value) if value > 0 else None
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip()) or None
    return None


def mam_torrent_id_for_release(release_data: dict[str, Any]) -> int | None:
    """The MAM torrent ID of a release payload, or None when it isn't a MAM torrent."""
    extra = release_data.get("extra")
    return _positive_int(extra.get("mam_torrent_id")) if isinstance(extra, dict) else None


def is_mam_release(release_data: dict[str, Any]) -> bool:
    """Whether a release payload is a MyAnonamouse torrent (tagged at search time)."""
    extra = release_data.get("extra")
    return isinstance(extra, dict) and _positive_int(extra.get("mam_torrent_id")) is not None


def mam_charge_bytes_for_release(release_data: dict[str, Any]) -> int:
    """Bytes a release adds to MAM's downloaded total: its size, or 0 when freeleech.

    Also 0 for anything that isn't a MAM torrent, or whose size is unknown.
    """
    if not is_mam_release(release_data):
        return 0
    extra = release_data.get("extra")
    if isinstance(extra, dict) and extra.get("freeleech"):
        return 0
    return _positive_int(release_data.get("size_bytes")) or 0


def mam_torrent_page(torrent_id: object) -> str | None:
    """The torrent's page on MyAnonamouse, from its id (None without one)."""
    value = _positive_int(torrent_id)
    return f"https://www.myanonamouse.net/t/{value}" if value is not None else None
