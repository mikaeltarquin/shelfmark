"""Tests for the Audiobookshelf library provider and per-format ownership."""

from __future__ import annotations

from typing import Any

import pytest

from shelfmark.core import library_index
from shelfmark.core.library_providers.audiobookshelf import (
    AudiobookshelfError,
    AudiobookshelfLibrary,
    entry_from_item,
)

from .test_library_index import _book, _Provider


def _item(
    title: str = "Dungeon Crawler Carl",
    *,
    audio: int = 1,
    ebook: str | None = None,
    narrators: str = "Jeff Hays",
    series: str = "Dungeon Crawler Carl #1",
    isbn: str | None = None,
) -> dict[str, Any]:
    return {
        "id": title,
        "media": {
            "metadata": {
                "title": title,
                "authorName": "Matt Dinniman",
                "narratorName": narrators,
                "seriesName": series,
                "isbn": isbn,
                "asin": "b08bx5ndw3",
            },
            "numAudioFiles": audio,
            "numTracks": audio,
            "ebookFormat": ebook,
        },
    }


class TestEntryFromItem:
    def test_audiobook(self):
        entry = entry_from_item(_item())
        assert entry is not None
        assert entry.content_types == {"audiobook"}
        assert entry.narrators == {"jeff hays"}
        assert entry.asins == {"B08BX5NDW3"}
        assert {"dungeon", "crawler", "carl"} <= entry.title_tokens
        assert {"matt", "dinniman"} <= entry.context_tokens

    def test_combined_item_counts_for_both(self):
        entry = entry_from_item(_item(ebook="epub"))
        assert entry is not None and entry.content_types == {"audiobook", "ebook"}

    def test_ebook_only(self):
        entry = entry_from_item(_item(audio=0, ebook="epub", narrators=""))
        assert entry is not None and entry.content_types == {"ebook"}

    def test_several_narrators(self):
        entry = entry_from_item(_item(narrators="Kate Reading, Michael Kramer"))
        assert entry is not None and entry.narrators == {"kate reading", "michael kramer"}

    @pytest.mark.parametrize(
        "item",
        [
            _item(audio=0, ebook=None),  # files missing
            {"media": {"metadata": {"title": ""}, "numAudioFiles": 1}},
            {"id": "x"},
        ],
    )
    def test_nothing_to_index(self, item):
        assert entry_from_item(item) is None


class FakeAbs(AudiobookshelfLibrary):
    def __init__(self, pages: dict[str, list[list[dict]]], overrides: dict | None = None):
        super().__init__(
            {
                "LIBRARY_CHECK_ABS_ENABLED": True,
                "ABS_URL": "http://abs",
                "ABS_API_KEY": "k",
                **(overrides or {}),
            }
        )
        self.pages = pages
        self.calls: list[tuple[str, dict | None]] = []

    def _get(self, path: str, params: dict[str, Any] | None = None, timeout: float = 30) -> Any:
        self.calls.append((path, params))
        if path == "/api/libraries":
            return {
                "libraries": [
                    {"id": "books", "name": "Books", "mediaType": "book"},
                    {"id": "casts", "name": "Podcasts", "mediaType": "podcast"},
                    {"id": "other", "name": "Other", "mediaType": "book"},
                ]
            }
        library_id = path.split("/")[3]
        pages = self.pages.get(library_id, [])
        page = (params or {}).get("page", 0)
        return {"results": pages[page] if page < len(pages) else []}


class TestFetch:
    def test_pages_through_book_libraries(self, monkeypatch):
        monkeypatch.setattr("shelfmark.core.library_providers.audiobookshelf._PAGE_SIZE", 2)
        abs_ = FakeAbs({"books": [[_item("A"), _item("B")], [_item("C")]], "other": [[_item("D")]]})

        entries = abs_.fetch_entries()

        assert len(entries) == 4
        assert not any("casts" in path for path, _ in abs_.calls)
        assert all(
            params == {"limit": 2, "page": params["page"], "minified": 1}
            for path, params in abs_.calls
            if params
        )

    def test_only_chosen_libraries(self):
        abs_ = FakeAbs(
            {"books": [[_item("A")]], "other": [[_item("D")]]}, {"ABS_LIBRARY_IDS": "other"}
        )
        assert len(abs_.fetch_entries()) == 1

    def test_chosen_libraries_from_the_picker(self):
        abs_ = FakeAbs(
            {"books": [[_item("A")]], "other": [[_item("D")]]}, {"ABS_LIBRARY_IDS": ["books"]}
        )
        assert len(abs_.fetch_entries()) == 1

    def test_all_option_reads_every_library(self):
        abs_ = FakeAbs(
            {"books": [[_item("A")]], "other": [[_item("D")]]},
            {"ABS_LIBRARY_IDS": ["all", "books"]},
        )
        assert len(abs_.fetch_entries()) == 2

    def test_needs_url_and_key(self):
        library = AudiobookshelfLibrary(
            {"LIBRARY_CHECK_ABS_ENABLED": True, "ABS_URL": "http://abs"}
        )
        assert not library.is_enabled()
        with pytest.raises(AudiobookshelfError):
            library.libraries()


@pytest.fixture
def abs_library(monkeypatch):
    items = [
        entry_from_item(_item(narrators="Jeff Hays")),
        entry_from_item(
            _item(
                "Carl's Doomsday Scenario",
                ebook="epub",
                narrators="Jeff Hays",
                series="Dungeon Crawler Carl #2",
            )
        ),
        entry_from_item(_item("Project Hail Mary", audio=0, ebook="epub", narrators="")),
    ]
    provider = _Provider("audiobookshelf", {"audiobook", "ebook"}, [e for e in items if e])
    provider.display_name = "Audiobookshelf"
    calibre = _Provider("calibre", {"ebook"}, [])
    calibre.display_name = "Calibre"
    monkeypatch.setattr(library_index, "all_providers", lambda overrides=None: [calibre, provider])
    monkeypatch.setattr(library_index, "_cache", {})
    return provider


class TestOwnership:
    def test_audiobook_only_item_does_not_count_as_the_ebook(self, abs_library):
        book = _book()
        assert library_index.ownership(book) == {"ebook": None, "audiobook": "owned"}
        assert library_index.ownership_sources(book) == {"audiobook": ["Audiobookshelf"]}

    def test_combined_item_counts_for_both(self, abs_library):
        book = _book(title="Carl's Doomsday Scenario", provider_id="2")
        assert library_index.ownership(book) == {"ebook": "owned", "audiobook": "owned"}

    def test_owned_narrators(self, abs_library):
        assert library_index.owned_narrators(_book()) == {"jeff hays"}
        assert (
            library_index.owned_narrators(_book(title="Project Hail Mary", authors=["Andy Weir"]))
            == set()
        )


class TestOwnedNarrationMarks:
    def test_marks_releases_by_narrator(self, abs_library):
        from shelfmark.main import _mark_owned_narrations

        releases = [
            {"source_id": "a", "extra": {"narrators": ["Jeff Hays"]}},
            {"source_id": "b", "extra": {"narrator": "Travis Baldree"}},
            {"source_id": "c", "extra": {}},
        ]

        _mark_owned_narrations(_book(), releases)

        assert [r["extra"].get("in_library") for r in releases] == [True, None, None]
