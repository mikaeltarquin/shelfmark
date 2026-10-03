"""The library browser's catalogue: every book in the enabled libraries, for display.

Built from the same cached rows as the ownership check (``library_index``), so browsing
never reads a library a second time. A book held by more than one library (the ebook in
Calibre, the audiobook in Audiobookshelf) is one catalogue book with both formats; two
items are the same book when their title words and the first author's surname agree.

Covers come from the library that holds the book. When it has none (or Calibre's book
folders are not mounted), the configured metadata provider is asked for one, as search
results show them; the answer is remembered in ``library_covers.json``.
"""

from __future__ import annotations

import dataclasses
import json
import threading
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from shelfmark.config.env import CONFIG_DIR
from shelfmark.core import library_index
from shelfmark.core.logger import setup_logger
from shelfmark.core.text_match import author_surname

if TYPE_CHECKING:
    from shelfmark.core.library_providers import LibraryEntry, LibraryItem, LibraryProvider
    from shelfmark.metadata_providers import BookMetadata

logger = setup_logger(__name__)

_COVERS_FILE = "library_covers.json"
_RETRY_MISSING_COVER_SECONDS = 7 * 24 * 3600
_MAX_CONCURRENT_COVER_LOOKUPS = 2


@dataclass
class CatalogCopy:
    """One library's copy of a catalogue book."""

    source: str
    item_id: str
    formats: list[str]
    has_cover: bool
    narrators: list[str] = field(default_factory=list)
    file_formats: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialize for the API: which formats this copy holds, read by whom, as what."""
        return {
            "source": self.source,
            "item_id": self.item_id,
            "formats": self.formats,
            "narrators": self.narrators,
            "file_formats": self.file_formats,
        }


@dataclass
class CatalogBook:
    """One book as the browser shows it."""

    id: str
    title: str
    authors: list[str]
    series: list[dict[str, str | None]]
    formats: list[str]
    narrators: list[str]
    added_at: float | None
    year: int | None
    cover: str
    copies: list[CatalogCopy] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialize for the API."""
        return {
            "id": self.id,
            "title": self.title,
            "authors": self.authors,
            "series": self.series,
            "formats": self.formats,
            "narrators": self.narrators,
            "added_at": self.added_at,
            "year": self.year,
            "cover": self.cover,
            "sources": sorted({copy.source for copy in self.copies}),
            "copies": [copy.to_dict() for copy in self.copies],
        }


def _formats(entry: LibraryEntry, provider: LibraryProvider) -> set[str]:
    return set(entry.content_types if entry.content_types is not None else provider.content_types)


def _merge_key(entry: LibraryEntry, item: LibraryItem) -> tuple[frozenset[str], str | None]:
    return entry.title_tokens, author_surname(item.authors[0] if item.authors else None)


def _add_unique(target: list[str], values: tuple[str, ...] | list[str]) -> None:
    for value in values:
        if value not in target:
            target.append(value)


def cover_path(source: str, item_id: str) -> str:
    """The API path that serves one library item's cover."""
    return f"/api/library/cover/{source}/{item_id}"


def build_catalog(
    rows: list[tuple[LibraryProvider, list[LibraryEntry]]],
) -> list[CatalogBook]:
    """Merge the providers' entries into catalogue books, sorted by title."""
    books: dict[tuple[frozenset[str], str | None], CatalogBook] = {}
    for provider, entries in rows:
        for entry in entries:
            item = entry.item
            if item is None:
                continue
            formats = _formats(entry, provider)
            copy = CatalogCopy(
                item.source,
                item.item_id,
                sorted(formats),
                item.has_cover,
                narrators=list(item.narrators),
                file_formats=list(item.file_formats),
            )
            series = [{"name": name, "number": number} for name, number in item.series]
            key = _merge_key(entry, item)
            book = books.get(key) if key[0] else None
            if book is None:
                book = CatalogBook(
                    id=f"{item.source}:{item.item_id}",
                    title=item.title,
                    authors=list(item.authors),
                    series=series,
                    formats=sorted(formats),
                    narrators=list(item.narrators),
                    added_at=item.added_at,
                    year=item.year,
                    cover=cover_path(item.source, item.item_id),
                    copies=[copy],
                )
                books[key if key[0] else (frozenset({book.id}), None)] = book
                continue
            book.copies.append(copy)
            book.formats = sorted(set(book.formats) | formats)
            _add_unique(book.authors, item.authors)
            _add_unique(book.narrators, item.narrators)
            if not book.series and series:
                book.series = series
            if item.added_at and (book.added_at is None or item.added_at > book.added_at):
                book.added_at = item.added_at
            book.year = book.year or item.year
            if item.has_cover and not any(c.has_cover for c in book.copies[:-1]):
                book.cover = cover_path(item.source, item.item_id)
    return sorted(books.values(), key=lambda b: (b.title.casefold(), b.id))


def catalog() -> list[CatalogBook]:
    """Every book in the enabled libraries (fail-open like the ownership check)."""
    rows = [
        (provider, library_index.provider_entries(provider))
        for provider in library_index.enabled_providers()
    ]
    return build_catalog(rows)


def find_entry(source: str, item_id: str) -> tuple[LibraryProvider, LibraryEntry] | None:
    """The cached entry for one library item."""
    for provider in library_index.enabled_providers():
        if provider.name != source:
            continue
        for entry in library_index.provider_entries(provider):
            if entry.item is not None and entry.item.item_id == item_id:
                return provider, entry
    return None


# --- Covers from the metadata provider ------------------------------------------------

_covers_lock = threading.Lock()
_lookup_slots = threading.BoundedSemaphore(_MAX_CONCURRENT_COVER_LOOKUPS)


def _covers_path() -> Any:
    return CONFIG_DIR / _COVERS_FILE


def _load_covers() -> dict[str, dict[str, Any]]:
    try:
        data = json.loads(_covers_path().read_text(encoding="utf-8"))
    except OSError, ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _remember_cover(key: str, url: str | None) -> None:
    with _covers_lock:
        covers = _load_covers()
        covers[key] = {"url": url, "at": time.time()}
        try:
            _covers_path().write_text(json.dumps(covers), encoding="utf-8")
        except OSError as exc:
            logger.debug("Could not save library cover cache: %s", exc)


def find_provider_book(entry: LibraryEntry, content_type: str) -> BookMetadata | None:
    """The metadata provider's record of a library item: by ISBN, else title and author.

    A title search result counts only when it matches the library item by the ownership
    check's own rules, so a similarly named book is never taken for it.
    """
    from shelfmark.metadata_providers import MetadataSearchOptions, get_configured_provider

    item = entry.item
    provider = get_configured_provider(content_type)
    if item is None or provider is None:
        return None
    if item.isbn:
        found = provider.search_by_isbn(item.isbn)
        # A library's ISBN can be wrong (a bad match in Audiobookshelf, another edition's
        # number), and the book it names is then someone else's. It counts only when the
        # title and author agree too; otherwise the title search below decides.
        if found is not None and _names_entry(found, entry):
            return found
        if found is not None:
            logger.info(
                "ISBN %s of %s:%s names %r, not %r; looking it up by title",
                item.isbn,
                item.source,
                item.item_id,
                found.title,
                item.title,
            )
    author = item.authors[0] if item.authors else ""
    results = provider.search_paginated(
        MetadataSearchOptions(query=f"{item.title} {author}".strip(), limit=5)
    ).books
    return next(
        (book for book in results if library_index.book_matches_entries(book, [entry])), None
    )


def _names_entry(book: BookMetadata, entry: LibraryEntry) -> bool:
    """Whether ``book`` is the library item by title and author, its ISBNs aside."""
    unnumbered = dataclasses.replace(book, isbn_10=None, isbn_13=None)
    return library_index.book_matches_entries(unnumbered, [entry])


def _lookup_cover(entry: LibraryEntry, content_type: str) -> str | None:
    found = find_provider_book(entry, content_type)
    return found.cover_url if found is not None else None


def provider_cover_url(provider: LibraryProvider, entry: LibraryEntry) -> str | None:
    """A cover for a library item from the metadata provider, remembered once found."""
    item = entry.item
    if item is None:
        return None
    key = f"{item.source}:{item.item_id}"
    cached = _load_covers().get(key)
    if cached is not None:
        url = cached.get("url")
        if url or time.time() - float(cached.get("at") or 0) < _RETRY_MISSING_COVER_SECONDS:
            return url or None
    content_type = "audiobook" if "audiobook" in _formats(entry, provider) else "ebook"
    with _lookup_slots:
        try:
            url = _lookup_cover(entry, content_type)
        except Exception as exc:  # noqa: BLE001 - a cover is never worth an error
            logger.debug("Cover lookup for %s failed: %s", key, exc)
            return None
    _remember_cover(key, url)
    return url
