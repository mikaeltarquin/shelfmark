from __future__ import annotations

from typing import Any

import pytest

from shelfmark.config import abs_settings
from shelfmark.core.library_providers import audiobookshelf

LIBRARIES = [{"id": "lib1", "name": "Audiobooks"}, {"id": "lib2", "name": "Ebooks"}]


@pytest.fixture(autouse=True)
def fresh_cache(monkeypatch):
    monkeypatch.setattr(abs_settings, "_listed", None)
    monkeypatch.setattr(abs_settings, "_failed_at", -1e9)
    monkeypatch.setattr(audiobookshelf, "chosen_library_ids", lambda overrides=None: set())


def _fake_provider(monkeypatch, *, enabled: bool = True, fail: bool = False) -> list[Any]:
    calls: list[Any] = []

    class Fake:
        def __init__(self, overrides=None) -> None:
            self.overrides = overrides

        def is_enabled(self) -> bool:
            return enabled

        def libraries(self, timeout: float = 30) -> list[dict[str, Any]]:
            calls.append((self.overrides, timeout))
            if fail:
                raise audiobookshelf.AudiobookshelfError("down")
            return LIBRARIES

    monkeypatch.setattr(audiobookshelf, "AudiobookshelfLibrary", Fake)
    return calls


def test_options_start_with_all(monkeypatch):
    _fake_provider(monkeypatch, enabled=False)
    assert abs_settings.get_abs_library_options() == [
        {"value": "all", "label": "All book libraries"}
    ]


def test_options_list_libraries_by_name_once(monkeypatch):
    calls = _fake_provider(monkeypatch)
    first = abs_settings.get_abs_library_options()
    second = abs_settings.get_abs_library_options()
    assert first == second
    assert [o["label"] for o in first] == ["All book libraries", "Audiobooks", "Ebooks"]
    assert [o["value"] for o in first] == ["all", "lib1", "lib2"]
    assert len(calls) == 1
    assert calls[0][1] == abs_settings._OPTIONS_TIMEOUT_SECONDS


def test_a_failed_listing_is_not_retried_straight_away(monkeypatch):
    calls = _fake_provider(monkeypatch, fail=True)
    assert len(abs_settings.get_abs_library_options()) == 1
    assert len(abs_settings.get_abs_library_options()) == 1
    assert len(calls) == 1


def test_saved_choices_stay_visible_before_a_listing(monkeypatch):
    _fake_provider(monkeypatch, fail=True)
    monkeypatch.setattr(audiobookshelf, "chosen_library_ids", lambda overrides=None: {"lib9"})
    options = abs_settings.get_abs_library_options()
    assert options[-1] == {"value": "lib9", "label": "Library not listed (press Test)"}


def test_test_action_fills_the_picker_from_unsaved_values(monkeypatch):
    calls = _fake_provider(monkeypatch)
    monkeypatch.setattr(
        "shelfmark.core.library_index.test_connection",
        lambda name, values: {"success": True, "message": "Read 3 items."},
    )
    result = abs_settings.check_abs_library({"ABS_URL": "http://abs", "ABS_API_KEY": "k"})

    assert result["success"]
    assert "Audiobooks, Ebooks" in result["message"]
    assert "lib1" not in result["message"]
    assert calls[0][0]["ABS_URL"] == "http://abs"
    assert [o["label"] for o in abs_settings.get_abs_library_options()][1:] == [
        "Audiobooks",
        "Ebooks",
    ]
    assert len(calls) == 1  # the picker reuses what Test listed


def test_test_action_reports_errors(monkeypatch):
    _fake_provider(monkeypatch, fail=True)
    result = abs_settings.check_abs_library({})
    assert not result["success"]
    assert "down" in result["message"]
