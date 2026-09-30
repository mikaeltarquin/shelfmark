"""Books by an author, or in a series, that the metadata provider knows and the library lacks.

The library browser shows these under "Not in your library" on author and series pages.
Every candidate carries the same per-format ``library`` ownership flags search results
do, so the page can hide what is owned in the format being looked at (a book owned as
an ebook is still missing as an audiobook).

A series needs a provider that can list one (Hardcover's ``series`` field); an author
needs an ``author`` field. With Hardcover the author is first resolved to its id, so the
list is that author's own books rather than a text match on the name.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import TYPE_CHECKING, Any

from shelfmark.core import library_index
from shelfmark.core.logger import setup_logger
from shelfmark.core.text_match import author_surname

if TYPE_CHECKING:
    from shelfmark.metadata_providers import BookMetadata, MetadataProvider

logger = setup_logger(__name__)

_PAGE_SIZE = 50
_MAX_PAGES = 4  # Up to 200 books per author or series


def _fold(value: str) -> str:
    return " ".join(value.split()).casefold()


def _result(
    *, supported: bool, provider: MetadataProvider | None, reason: str | None = None
) -> dict[str, Any]:
    return {
        "supported": supported,
        "reason": reason,
        "provider": provider.display_name if provider else None,
        "books": [],
    }


def _author_field_value(provider: MetadataProvider, author: str) -> str:
    """The provider's own id for the author when it can resolve one, else the name."""
    try:
        options = provider.get_search_field_options("author", query=author)
    except Exception as exc:  # noqa: BLE001 - fall back to a name search
        logger.debug("Could not resolve author %s: %s", author, exc)
        return author
    wanted = _fold(author)
    for option in options:
        if _fold(str(option.get("label") or "")) == wanted and option.get("value"):
            return str(option["value"])
    return author


def _series_sort(provider: MetadataProvider) -> Any:
    from shelfmark.metadata_providers import SortOrder

    for capability in provider.capabilities:
        if capability.key == "view_series" and capability.sort is not None:
            return capability.sort
    return SortOrder.RELEVANCE


def _fetch(provider: MetadataProvider, fields: dict[str, Any], sort: Any) -> list[BookMetadata]:
    from shelfmark.metadata_providers import MetadataSearchOptions

    books: list[BookMetadata] = []
    seen: set[str] = set()
    for page in range(1, _MAX_PAGES + 1):
        result = provider.search_paginated(
            MetadataSearchOptions(query="", fields=fields, sort=sort, limit=_PAGE_SIZE, page=page)
        )
        for book in result.books:
            if book.provider_id not in seen:
                seen.add(book.provider_id)
                books.append(book)
        if not result.has_more or not result.books:
            break
    return books


def _by_author(book: BookMetadata, author: str) -> bool:
    surname = author_surname(author)
    return any(author_surname(name) == surname for name in book.authors)


def _book_dict(book: BookMetadata) -> dict[str, Any]:
    from shelfmark.core.utils import transform_cover_url

    data = asdict(book)
    if data.get("cover_url"):
        data["cover_url"] = transform_cover_url(
            data["cover_url"], f"{data['provider']}_{data['provider_id']}"
        )
    owned = library_index.ownership(book)
    if owned is not None:
        data["library"] = owned
        data["library_sources"] = library_index.ownership_sources(book)
    return data


def candidates(kind: str, name: str, content_type: str = "ebook") -> dict[str, Any]:
    """What the metadata provider lists for an author or series, with ownership flags."""
    from shelfmark.metadata_providers import get_configured_provider

    provider = get_configured_provider(content_type)
    if provider is None or not provider.is_available():
        return _result(
            supported=False,
            provider=provider,
            reason="No metadata provider is set up, so missing books can't be listed.",
        )
    field_keys = {field.key for field in provider.search_fields}
    if kind == "series":
        if "series" not in field_keys:
            return _result(
                supported=False,
                provider=provider,
                reason=f"{provider.display_name} can't list a series. Hardcover can.",
            )
        books = _fetch(provider, {"series": name}, _series_sort(provider))
    else:
        if "author" not in field_keys:
            return _result(
                supported=False,
                provider=provider,
                reason=f"{provider.display_name} can't search by author.",
            )
        from shelfmark.metadata_providers import SortOrder

        value = _author_field_value(provider, name)
        books = _fetch(provider, {"author": value}, SortOrder.RELEVANCE)
        if value == name:  # A name search can bring in other authors' books
            books = [book for book in books if _by_author(book, name)]

    result = _result(supported=True, provider=provider)
    result["books"] = [_book_dict(book) for book in books]
    return result
