"""Library settings moved from General to the Libraries pages keep their saved values."""

from __future__ import annotations

import json
import logging

import pytest

from shelfmark.config import settings
from shelfmark.config.migrations import move_settings_between_tabs
from shelfmark.core import settings_registry

LOG = logging.getLogger("test")


def _move(source: dict, target: dict, defaults: dict | None = None) -> bool:
    return move_settings_between_tabs(
        ("A", "B"),
        load_source=lambda: source,
        replace_source=lambda values: source.update(values),
        load_target=lambda: target,
        replace_target=lambda values: target.update(values),
        defaults=defaults or {},
        logger=LOG,
    )


def test_moves_saved_values_and_removes_them_from_the_source():
    source = {"A": 1, "B": "x", "OTHER": True}
    stored: dict = {}

    moved = move_settings_between_tabs(
        ("A", "B"),
        load_source=lambda: dict(source),
        replace_source=lambda values: (source.clear(), source.update(values)),
        load_target=lambda: dict(stored),
        replace_target=lambda values: stored.update(values),
        defaults={},
        logger=LOG,
    )

    assert moved
    assert stored == {"A": 1, "B": "x"}
    assert source == {"OTHER": True}


def test_nothing_to_move():
    target: dict = {}
    assert not _move({"OTHER": 1}, target)
    assert target == {}


def test_saved_value_replaces_a_written_default_but_not_a_choice():
    target = {"A": "default", "B": "chosen"}
    _move({"A": "saved", "B": "saved"}, target, {"A": "default", "B": "default"})
    assert target == {"A": "saved", "B": "chosen"}


@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings_registry, "_get_config_dir", lambda: tmp_path)
    monkeypatch.setattr("shelfmark.core.config.config.refresh", lambda **_: None)
    return tmp_path


def _read(path):
    return json.loads(path.read_text())


def test_migrates_general_settings_files(config_dir):
    (config_dir / "settings.json").write_text(
        json.dumps(
            {
                "SEARCH_PAGE_TITLE": "Books",
                "LIBRARY_CHECK_ABS_ENABLED": True,
                "ABS_URL": "http://abs:80",
                "ABS_API_KEY": "secret",
                "ABS_LIBRARY_IDS": ["lib1"],
                "LIBRARY_CHECK_CALIBRE_ENABLED": True,
                "CALIBRE_LIBRARY_DB_PATH": "/books/metadata.db",
            }
        )
    )
    # Written with defaults on startup, before the migration runs.
    plugins = config_dir / "plugins"
    plugins.mkdir()
    (plugins / "library_calibre.json").write_text(
        json.dumps(
            {
                "LIBRARY_CHECK_CALIBRE_ENABLED": False,
                "CALIBRE_LIBRARY_DB_PATH": "/calibre-library/metadata.db",
            }
        )
    )

    settings.migrate_library_settings()

    assert _read(config_dir / "settings.json") == {"SEARCH_PAGE_TITLE": "Books"}
    assert _read(plugins / "library_audiobookshelf.json") == {
        "LIBRARY_CHECK_ABS_ENABLED": True,
        "ABS_URL": "http://abs:80",
        "ABS_API_KEY": "secret",
        "ABS_LIBRARY_IDS": ["lib1"],
    }
    assert _read(plugins / "library_calibre.json") == {
        "LIBRARY_CHECK_CALIBRE_ENABLED": True,
        "CALIBRE_LIBRARY_DB_PATH": "/books/metadata.db",
    }

    settings.migrate_library_settings()  # a second run changes nothing
    assert _read(config_dir / "settings.json") == {"SEARCH_PAGE_TITLE": "Books"}


def test_library_tabs_are_grouped():
    tabs = {tab.name: tab for tab in settings_registry.get_all_settings_tabs()}
    for name in ("library_audiobookshelf", "library_calibre", "library_kavita"):
        assert tabs[name].group == "libraries"
    general_keys = {f.key for f in settings_registry.iter_value_fields(tabs["general"])}
    assert not general_keys & {"ABS_URL", "CALIBRE_LIBRARY_DB_PATH"}
