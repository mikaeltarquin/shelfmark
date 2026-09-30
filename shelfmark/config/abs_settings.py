"""Audiobookshelf library-check settings: the library picker's options and the Test action.

Test lists the server's book libraries with the form's current (possibly unsaved) URL and
API key and keeps the list, so the library picker can offer them by name right away. When
nothing has been listed yet, the picker lists them once with the saved settings, with a
short timeout so an unreachable server doesn't hold up the settings page.
"""

from __future__ import annotations

import threading
import time
from typing import Any

from shelfmark.core.logger import setup_logger

logger = setup_logger(__name__)

_OPTIONS_TIMEOUT_SECONDS = 5
_RETRY_AFTER_SECONDS = 60

_lock = threading.Lock()
_listed: list[dict[str, str]] | None = None
_failed_at = 0.0


def _library_options(libraries: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [
        {"value": str(lib["id"]), "label": str(lib.get("name") or "Unnamed library")}
        for lib in libraries
        if lib.get("id")
    ]


def _remember(options: list[dict[str, str]]) -> None:
    global _listed
    with _lock:
        _listed = options


def get_abs_library_options() -> list[dict[str, str]]:
    """Options for the library picker: "All book libraries", then each library by name."""
    from shelfmark.core.library_providers.audiobookshelf import (
        ALL_LIBRARIES,
        AudiobookshelfLibrary,
        chosen_library_ids,
    )

    global _failed_at
    options = [{"value": ALL_LIBRARIES, "label": "All book libraries"}]
    with _lock:
        listed = _listed
        failed_recently = time.monotonic() - _failed_at < _RETRY_AFTER_SECONDS
    if listed is None and not failed_recently:
        provider = AudiobookshelfLibrary()
        if provider.is_enabled():
            try:
                listed = _library_options(provider.libraries(timeout=_OPTIONS_TIMEOUT_SECONDS))
            except Exception as exc:  # noqa: BLE001 - the picker falls back to "all"
                logger.debug("Could not list Audiobookshelf libraries: %s", exc)
                with _lock:
                    _failed_at = time.monotonic()
            else:
                _remember(listed)
    options += listed or []
    # Keep a saved choice visible (and removable) when it isn't in the listing.
    known = {option["value"] for option in options}
    options += [
        {"value": library_id, "label": "Library not listed (press Test)"}
        for library_id in sorted(chosen_library_ids() - known)
    ]
    return options


def check_abs_library(current_values: dict[str, Any] | None = None) -> dict[str, Any]:
    """Settings action: list the Audiobookshelf libraries and index the chosen ones."""
    from shelfmark.core import library_index
    from shelfmark.core.library_providers.audiobookshelf import AudiobookshelfLibrary

    values = {**(current_values or {}), "LIBRARY_CHECK_ABS_ENABLED": True}
    try:
        libraries = AudiobookshelfLibrary(values).libraries()
    except Exception as exc:  # noqa: BLE001 - shown to the user
        return {"success": False, "message": f"Audiobookshelf: {exc}"}
    options = _library_options(libraries)
    _remember(options)
    if not options:
        return {"success": False, "message": "Audiobookshelf has no book libraries."}
    result = library_index.test_connection("audiobookshelf", values)
    names = ", ".join(option["label"] for option in options)
    if result.get("success"):
        result["message"] = (
            f"{result['message']} Book libraries: {names}. Choose which to read below."
        )
    return result
