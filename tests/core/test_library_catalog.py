"""Tests for the library browser's catalogue and covers."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest

from shelfmark.core import library_catalog
from shelfmark.core.library_providers import LibraryEntry, LibraryItem
from shelfmark.core.library_providers import calibre as calibre_module
from shelfmark.core.library_providers.audiobookshelf import entry_from_item
from shelfmark.core.text_match import tokens
from shelfmark.metadata_providers import BookMetadata, SearchResult


class _Provider:
    def __init__(self, name: str, content_types: set[str]) -> None:
        self.name = name
        self.display_name = name.title()
        self.content_types = frozenset(content_types)


def _entry(
    source: str,
    item_id: str,
    title: str,
    author: str = "Andy Weir",
    *,
    formats: set[str] | None = None,
    series: tuple[tuple[str, str | None], ...] = (),
    added_at: float | None = None,
    has_cover: bool = True,
    isbn: str | None = None,
) -> LibraryEntry:
    title_tok = frozenset(tokens(title))
    context = frozenset(tokens(author))
    return LibraryEntry(
        tokens=title_tok | context,
        isbns=frozenset({isbn} if isbn else ()),
        asins=frozenset(),
        title_tokens=title_tok,
        context_tokens=context,
        content_types=frozenset(formats) if formats else None,
        item=LibraryItem(
            source=source,
            item_id=item_id,
            title=title,
            authors=(author,),
            series=series,
            added_at=added_at,
            has_cover=has_cover,
            isbn=isbn,
        ),
    )


CALIBRE = _Provider("calibre", {"ebook"})
ABS = _Provider("audiobookshelf", {"audiobook", "ebook"})


class TestBuildCatalog:
    def test_same_book_in_two_libraries_is_one_book(self):
        books = library_catalog.build_catalog(
            [
                (CALIBRE, [_entry("calibre", "1", "The Martian", added_at=100)]),
                (
                    ABS,
                    [
                        _entry(
                            "audiobookshelf",
                            "li_1",
                            "The Martian",
                            formats={"audiobook"},
                            series=(("Mars", "1"),),
                            added_at=200,
                        )
                    ],
                ),
            ]
        )
        assert len(books) == 1
        book = books[0].to_dict()
        assert book["formats"] == ["audiobook", "ebook"]
        assert book["sources"] == ["audiobookshelf", "calibre"]
        assert book["series"] == [{"name": "Mars", "number": "1"}]
        assert book["added_at"] == 200
        assert book["cover"] == "/api/library/cover/calibre/1"

    def test_different_authors_stay_apart(self):
        books = library_catalog.build_catalog(
            [
                (
                    CALIBRE,
                    [
                        _entry("calibre", "1", "Dune", "Frank Herbert"),
                        _entry("calibre", "2", "Dune", "Someone Else"),
                    ],
                )
            ]
        )
        assert len(books) == 2

    def test_cover_prefers_a_copy_that_has_one(self):
        books = library_catalog.build_catalog(
            [
                (CALIBRE, [_entry("calibre", "1", "Artemis", has_cover=False)]),
                (ABS, [_entry("audiobookshelf", "li_2", "Artemis", formats={"audiobook"})]),
            ]
        )
        assert books[0].cover == "/api/library/cover/audiobookshelf/li_2"

    def test_sorted_by_title_and_entries_without_items_skipped(self):
        bare = LibraryEntry(frozenset({"x"}), frozenset(), frozenset())
        books = library_catalog.build_catalog(
            [(CALIBRE, [_entry("calibre", "2", "Zebra"), bare, _entry("calibre", "1", "apple")])]
        )
        assert [b.title for b in books] == ["apple", "Zebra"]


class TestAudiobookshelfItem:
    def test_display_fields(self):
        entry = entry_from_item(
            {
                "id": "li_9",
                "addedAt": 1_700_000_000_000,
                "media": {
                    "coverPath": "/metadata/items/li_9/cover.jpg",
                    "numAudioFiles": 3,
                    "metadata": {
                        "title": "Project Hail Mary",
                        "authorName": "Andy Weir",
                        "narratorName": "Ray Porter",
                        "seriesName": "Standalone #1, Other",
                        "publishedYear": "2021",
                        "isbn": "9780593135204",
                    },
                },
            }
        )
        assert entry is not None and entry.item is not None
        item = entry.item
        assert item.item_id == "li_9"
        assert item.added_at == 1_700_000_000
        assert item.series == (("Standalone", "1"), ("Other", None))
        assert item.narrators == ("Ray Porter",)
        assert item.year == 2021
        assert item.has_cover
        assert item.isbn == "9780593135204"


_FULL_SCHEMA = """
CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT NOT NULL, timestamp TIMESTAMP,
    pubdate TIMESTAMP, has_cover BOOL, path TEXT, series_index REAL);
CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE books_authors_link (id INTEGER PRIMARY KEY, book INTEGER, author INTEGER);
CREATE TABLE series (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE books_series_link (id INTEGER PRIMARY KEY, book INTEGER, series INTEGER);
CREATE TABLE identifiers (id INTEGER PRIMARY KEY, book INTEGER, type TEXT, val TEXT);
"""


@pytest.fixture
def calibre_library(tmp_path: Path) -> Path:
    db = tmp_path / "metadata.db"
    with closing(sqlite3.connect(db)) as conn:
        conn.executescript(_FULL_SCHEMA)
        conn.executemany(
            "INSERT INTO books VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    1,
                    "The Martian",
                    "2024-05-01 10:00:00+00:00",
                    "2014-02-11 00:00:00+00:00",
                    1,
                    "Andy Weir/The Martian (1)",
                    1.0,
                ),
                (
                    2,
                    "Draft",
                    "2024-06-01 10:00:00+00:00",
                    "0101-01-01 00:00:00+00:00",
                    0,
                    "Unknown/Draft (2)",
                    1.0,
                ),
            ],
        )
        conn.execute("INSERT INTO authors VALUES (1, 'Andy Weir')")
        conn.execute("INSERT INTO books_authors_link(book, author) VALUES (1, 1)")
        conn.execute("INSERT INTO series VALUES (1, 'Mars')")
        conn.execute("INSERT INTO books_series_link(book, series) VALUES (1, 1)")
        conn.execute("INSERT INTO identifiers(book, type, val) VALUES (1, 'isbn', '9780804139021')")
        conn.commit()
    cover_dir = tmp_path / "Andy Weir" / "The Martian (1)"
    cover_dir.mkdir(parents=True)
    (cover_dir / "cover.jpg").write_bytes(b"jpg")
    return db


class TestCalibreItem:
    def test_display_fields(self, calibre_library: Path):
        library = calibre_module.CalibreLibrary({"CALIBRE_LIBRARY_DB_PATH": str(calibre_library)})
        items = {e.item.item_id: e.item for e in library.fetch_entries() if e.item}
        martian = items["1"]
        assert martian.authors == ("Andy Weir",)
        assert martian.series == (("Mars", "1"),)
        assert martian.year == 2014
        assert martian.added_at is not None
        assert martian.has_cover
        assert martian.isbn == "9780804139021"
        assert items["2"].year is None
        assert not items["2"].has_cover

    def test_cover_path(self, calibre_library: Path):
        library = calibre_module.CalibreLibrary({"CALIBRE_LIBRARY_DB_PATH": str(calibre_library)})
        path = library.cover_path("1")
        assert path is not None and path.read_bytes() == b"jpg"
        assert library.cover_path("2") is None
        assert library.cover_path("../1") is None


class TestProviderCover:
    @pytest.fixture(autouse=True)
    def covers_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr(library_catalog, "CONFIG_DIR", tmp_path)

    def _metadata(self, monkeypatch, *, by_isbn: str | None, search: list[BookMetadata]):
        calls: list[Any] = []

        class Fake:
            def search_by_isbn(self, isbn):
                calls.append(("isbn", isbn))
                return BookMetadata("hardcover", "1", "x", cover_url=by_isbn) if by_isbn else None

            def search_paginated(self, options):
                calls.append(("search", options.query))
                return SearchResult(books=search)

        monkeypatch.setattr(
            "shelfmark.metadata_providers.get_configured_provider", lambda content_type: Fake()
        )
        return calls

    def test_isbn_lookup_is_remembered(self, monkeypatch):
        calls = self._metadata(monkeypatch, by_isbn="https://img/1.jpg", search=[])
        entry = _entry("calibre", "1", "The Martian", isbn="9780804139021", has_cover=False)
        assert library_catalog.provider_cover_url(CALIBRE, entry) == "https://img/1.jpg"
        assert library_catalog.provider_cover_url(CALIBRE, entry) == "https://img/1.jpg"
        assert calls == [("isbn", "9780804139021")]

    def test_title_search_needs_a_matching_book(self, monkeypatch):
        other = BookMetadata("hardcover", "2", "Artemis", authors=["Andy Weir"], cover_url="u2")
        same = BookMetadata("hardcover", "3", "The Martian", authors=["Andy Weir"], cover_url="u3")
        calls = self._metadata(monkeypatch, by_isbn=None, search=[other, same])
        entry = _entry("calibre", "1", "The Martian", has_cover=False)
        assert library_catalog.provider_cover_url(CALIBRE, entry) == "u3"
        assert calls == [("search", "The Martian Andy Weir")]

    def test_no_cover_is_not_retried_straight_away(self, monkeypatch):
        calls = self._metadata(monkeypatch, by_isbn=None, search=[])
        entry = _entry("calibre", "1", "The Martian", has_cover=False)
        assert library_catalog.provider_cover_url(CALIBRE, entry) is None
        assert library_catalog.provider_cover_url(CALIBRE, entry) is None
        assert len(calls) == 1


@pytest.fixture(scope="module")
def main_module():
    import importlib
    from unittest.mock import patch

    with patch("shelfmark.download.orchestrator.start"):
        import shelfmark.main as main

        importlib.reload(main)
        return main


def _client(main_module, *, is_admin: bool):
    client = main_module.app.test_client()
    with client.session_transaction() as sess:
        sess["user_id"] = "tester"
        sess["is_admin"] = is_admin
    return client


class TestRoutes:
    def test_books(self, main_module, monkeypatch):
        monkeypatch.setattr("shelfmark.core.library_index.enabled_providers", lambda: [CALIBRE])
        monkeypatch.setattr(
            "shelfmark.core.library_index.provider_entries",
            lambda provider: [_entry("calibre", "1", "The Martian")],
        )
        body = _client(main_module, is_admin=True).get("/api/library/books").get_json()
        assert body["enabled"] is True
        assert body["sources"] == [{"name": "calibre", "display_name": "Calibre"}]
        assert [b["title"] for b in body["books"]] == ["The Martian"]

    def test_admin_only(self, main_module, monkeypatch):
        monkeypatch.setattr("shelfmark.core.route_guards.load_active_auth_mode", lambda: "builtin")
        client = _client(main_module, is_admin=False)
        assert client.get("/api/library/books").status_code == 403
        assert client.get("/api/library/cover/calibre/1").status_code == 403

    def test_cover_falls_back_to_metadata_provider(self, main_module, monkeypatch):
        entry = _entry("calibre", "1", "The Martian", has_cover=False)
        monkeypatch.setattr(library_catalog, "find_entry", lambda source, item_id: (CALIBRE, entry))
        monkeypatch.setattr(
            library_catalog, "provider_cover_url", lambda provider, e: "https://img/x.jpg"
        )
        resp = _client(main_module, is_admin=True).get("/api/library/cover/calibre/1")
        assert resp.status_code == 302
        assert resp.headers["Location"] == "https://img/x.jpg"

    def test_cover_rejects_odd_ids(self, main_module):
        resp = _client(main_module, is_admin=True).get("/api/library/cover/calibre/a.b")
        assert resp.status_code == 400
