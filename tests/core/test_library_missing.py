"""Tests for the library browser's "Not in your library" candidates."""

from __future__ import annotations

from typing import Any

import pytest

from shelfmark.core import library_missing
from shelfmark.metadata_providers import (
    BookMetadata,
    MetadataCapability,
    SearchResult,
    SortOrder,
    TextSearchField,
)


class FakeProvider:
    name = "hardcover"
    display_name = "Hardcover"

    def __init__(self, pages: list[list[BookMetadata]], *, fields=("author", "series"), authors=()):
        self.pages = pages
        self.search_fields = tuple(TextSearchField(key=key, label=key) for key in fields)
        self.capabilities = (
            MetadataCapability(key="view_series", field_key="series", sort=SortOrder.SERIES_ORDER),
        )
        self.author_options = list(authors)
        self.calls: list[Any] = []

    def is_available(self) -> bool:
        return True

    def get_search_field_options(self, field_key: str, query: str | None = None):
        return self.author_options if field_key == "author" else []

    def search_paginated(self, options) -> SearchResult:
        self.calls.append((options.fields, options.sort, options.page))
        index = options.page - 1
        books = self.pages[index] if index < len(self.pages) else []
        return SearchResult(books=books, page=options.page, has_more=index + 1 < len(self.pages))


def _book(book_id: str, title: str, author: str = "Brandon Sanderson") -> BookMetadata:
    return BookMetadata("hardcover", book_id, title, authors=[author])


@pytest.fixture
def use_provider(monkeypatch):
    def install(provider: FakeProvider | None) -> None:
        monkeypatch.setattr(
            "shelfmark.metadata_providers.get_configured_provider",
            lambda content_type: provider,
        )

    monkeypatch.setattr(
        library_missing.library_index, "ownership", lambda book: {"ebook": None, "audiobook": None}
    )
    monkeypatch.setattr(library_missing.library_index, "ownership_sources", lambda book: {})
    return install


def test_series_pages_through_in_series_order(use_provider):
    provider = FakeProvider(
        [[_book("1", "The Final Empire")], [_book("2", "The Well of Ascension")]]
    )
    use_provider(provider)

    result = library_missing.candidates("series", "Mistborn")

    assert result["supported"] and result["provider"] == "Hardcover"
    assert [b["title"] for b in result["books"]] == ["The Final Empire", "The Well of Ascension"]
    assert result["books"][0]["library"] == {"ebook": None, "audiobook": None}
    assert provider.calls == [
        ({"series": "Mistborn"}, SortOrder.SERIES_ORDER, 1),
        ({"series": "Mistborn"}, SortOrder.SERIES_ORDER, 2),
    ]


def test_author_resolved_to_the_provider_id(use_provider):
    provider = FakeProvider(
        [[_book("1", "Elantris"), _book("2", "Someone Else's Book", "Other Person")]],
        authors=[{"value": "id:99", "label": "Brandon Sanderson"}],
    )
    use_provider(provider)

    result = library_missing.candidates("author", "brandon sanderson")

    assert provider.calls[0][0] == {"author": "id:99"}
    # An id lookup is the author's own list, so nothing is filtered out.
    assert len(result["books"]) == 2


def test_author_name_search_keeps_only_that_author(use_provider):
    provider = FakeProvider([[_book("1", "Elantris"), _book("2", "Other", "Other Person")]])
    use_provider(provider)

    result = library_missing.candidates("author", "Brandon Sanderson")

    assert provider.calls[0][0] == {"author": "Brandon Sanderson"}
    assert [b["title"] for b in result["books"]] == ["Elantris"]


def test_duplicates_across_pages_are_dropped(use_provider):
    use_provider(FakeProvider([[_book("1", "A")], [_book("1", "A"), _book("2", "B")]]))
    result = library_missing.candidates("series", "S")
    assert [b["provider_id"] for b in result["books"]] == ["1", "2"]


def test_unsupported(use_provider):
    use_provider(FakeProvider([], fields=("author",)))
    result = library_missing.candidates("series", "Mistborn")
    assert not result["supported"]
    assert "can't list a series" in result["reason"]

    use_provider(None)
    assert not library_missing.candidates("author", "X")["supported"]
