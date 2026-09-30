"""Library ownership check: is this book already in one of the user's libraries?

Each ``LibraryProvider`` (see ``library_providers``) indexes its library into
``LibraryEntry`` rows. This module caches those rows per provider, routes a lookup to
the providers that hold the requested content type, and matches by identifier first
(the book's id in the same metadata provider, ISBN in either 10 or 13 form), otherwise
fuzzy title-token overlap plus the author surname (``text_match``) - the same rule the
release matcher in ``auto_download`` uses.

Fail-open by design: a disabled or unreachable library never stalls the pipeline.
``is_in_library`` answers False (or from the stale cache) and logs a warning.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from shelfmark.core.library_providers import all_providers
from shelfmark.core.logger import setup_logger
from shelfmark.core.text_match import (
    COLLECTION_MARKERS,
    author_surname,
    extra_work_tokens,
    isbn_variants,
    title_tokens_match,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

    from shelfmark.core.library_providers import LibraryEntry, LibraryProvider
    from shelfmark.metadata_providers import BookMetadata

logger = setup_logger(__name__)

_CACHE_TTL_SECONDS = 600  # Re-index a library at most every 10 minutes unless it changed.


@dataclass
class _CacheSlot:
    entries: list[LibraryEntry] | None = None
    fetched_at: float = 0.0
    fingerprint: object | None = None


_lock = threading.Lock()
_cache: dict[str, _CacheSlot] = {}


def _slot(provider_name: str) -> _CacheSlot:
    with _lock:
        return _cache.setdefault(provider_name, _CacheSlot())


def _store(provider_name: str, entries: list[LibraryEntry], fingerprint: object | None) -> None:
    slot = _slot(provider_name)
    with _lock:
        slot.entries = entries
        slot.fetched_at = time.monotonic()
        slot.fingerprint = fingerprint


def _entries_for(provider: LibraryProvider) -> list[LibraryEntry]:
    """Cached entries for one provider, re-indexed past the TTL or when the library changed."""
    slot = _slot(provider.name)
    try:
        fingerprint = provider.fingerprint()
        with _lock:
            cached = slot.entries
            fresh = time.monotonic() - slot.fetched_at < _CACHE_TTL_SECONDS
            unchanged = fingerprint == slot.fingerprint
        if cached is not None and fresh and unchanged:
            return cached
        entries = provider.fetch_entries()
    except Exception as exc:  # noqa: BLE001 - any failure must fail open
        logger.warning("library check: %s unavailable (%s); failing open", provider.describe(), exc)
        with _lock:
            return slot.entries or []  # Use the stale cache if we have one.

    _store(provider.name, entries, fingerprint)
    logger.info("library check: indexed %d %s item(s)", len(entries), provider.display_name)
    return entries


def _enabled_providers(content_type: str | None) -> list[LibraryProvider]:
    return [
        provider
        for provider in all_providers()
        if provider.is_enabled()
        and (content_type is None or content_type in provider.content_types)
    ]


def enabled_providers() -> list[LibraryProvider]:
    """Every enabled library provider."""
    return _enabled_providers(None)


def provider_entries(provider: LibraryProvider) -> list[LibraryEntry]:
    """One provider's cached entries (fail-open: stale or empty when it can't be read)."""
    return _entries_for(provider)


def any_provider_enabled() -> bool:
    return any(provider.is_enabled() for provider in all_providers())


def match_entries(book: BookMetadata, entries: list[LibraryEntry]) -> str | None:
    """How ``book`` is held: ``"owned"``, ``"collection"``, or None when it is not.

    ``"collection"`` means a shelf title that bundles several works matched, e.g. an
    omnibus. The reader has the book, but saying so plainly would misdescribe what is
    on the shelf.
    """
    if not entries:
        return None

    external_id = (book.provider, str(book.provider_id)) if book.provider_id else None
    book_isbns = isbn_variants(book.isbn_13) | isbn_variants(book.isbn_10)
    for entry in entries:
        if external_id in entry.external_ids or entry.isbns & book_isbns:
            return "owned"

    title = book.search_title or book.title
    surname = author_surname(book.search_author or (book.authors[0] if book.authors else ""))
    collection: str | None = None
    for entry in entries:
        if not title_tokens_match(title, set(entry.tokens)):
            continue
        if surname is not None and surname not in entry.tokens:
            continue
        # A shorter search title is a subset of every longer shelf title sharing its
        # words, so "Dune" matched "Dune Messiah". Words the shelf adds that name
        # another work disqualify it; packaging words do not.
        if extra_work_tokens(set(entry.title_tokens), title, set(entry.context_tokens)):
            continue
        if entry.title_tokens & COLLECTION_MARKERS:
            collection = "collection"
            continue
        return "owned"

    return collection


def book_matches_entries(book: BookMetadata, entries: list[LibraryEntry]) -> bool:
    """True if ``book`` is on the shelf at all, however it is packaged."""
    return match_entries(book, entries) is not None


def _entries_of_type(provider: LibraryProvider, content_type: str | None) -> list[LibraryEntry]:
    """A provider's entries that hold ``content_type`` (all of them for None)."""
    entries = _entries_for(provider)
    if content_type is None:
        return entries
    return [e for e in entries if e.content_types is None or content_type in e.content_types]


def is_in_library(book: BookMetadata, content_type: str | None = None) -> bool:
    """True if an enabled library holding ``content_type`` already has ``book`` (fail-open).

    ``content_type`` None consults every enabled provider.
    """
    return any(
        book_matches_entries(book, _entries_of_type(provider, content_type))
        for provider in _enabled_providers(content_type)
    )


def _holdings(book: BookMetadata, content_type: str) -> dict[str, str]:
    """How each enabled library holding ``content_type`` holds the book, by display name."""
    holdings: dict[str, str] = {}
    for provider in _enabled_providers(content_type):
        kind = match_entries(book, _entries_of_type(provider, content_type))
        if kind is not None:
            holdings[provider.display_name] = kind
    return holdings


def _holding(book: BookMetadata, content_type: str) -> str | None:
    """Strongest holding across the enabled libraries for one content type."""
    kinds = set(_holdings(book, content_type).values())
    if "owned" in kinds:
        return "owned"
    return "collection" if "collection" in kinds else None


def ownership_sources(book: BookMetadata) -> dict[str, list[str]]:
    """Which libraries hold the book, per format: ``{"audiobook": ["Audiobookshelf"]}``."""
    sources = {
        content_type: sorted(_holdings(book, content_type))
        for content_type in ("ebook", "audiobook")
        if _enabled_providers(content_type)
    }
    return {content_type: names for content_type, names in sources.items() if names}


def owned_narrators(book: BookMetadata) -> set[str]:
    """Narrators (casefolded) of the audiobooks of ``book`` already in a library."""
    narrators: set[str] = set()
    for provider in _enabled_providers("audiobook"):
        for entry in _entries_of_type(provider, "audiobook"):
            if entry.narrators and match_entries(book, [entry]) is not None:
                narrators |= entry.narrators
    return narrators


def ownership(book: BookMetadata) -> dict[str, str | None] | None:
    """Per-format holding for the UI: ``{"ebook": "owned" | "collection" | None}``.

    Only content types with an enabled library are reported; None when no library
    check is enabled at all. Fail-open like ``is_in_library``.
    """
    result = {
        content_type: _holding(book, content_type)
        for content_type in ("ebook", "audiobook")
        if _enabled_providers(content_type)
    }
    return result or None


def test_connection(provider_name: str, current_values: Mapping[str, Any] | None) -> dict[str, Any]:
    """Settings action: index one library now and report the item count.

    ``current_values`` are the unsaved form values, so the button works before Save.
    """
    provider = next((p for p in all_providers(current_values) if p.name == provider_name), None)
    if provider is None:
        return {"success": False, "message": f"Unknown library provider: {provider_name}"}
    try:
        fingerprint = provider.fingerprint()
        entries = provider.fetch_entries()
    except Exception as exc:  # noqa: BLE001 - surface any error to the user
        return {"success": False, "message": f"{provider.describe()}: {exc}"}
    _store(provider.name, entries, fingerprint)
    return {"success": True, "message": f"{provider.describe()}: indexed {len(entries)} item(s)."}
