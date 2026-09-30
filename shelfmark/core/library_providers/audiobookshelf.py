"""Audiobookshelf library provider.

Reads the book libraries of an Audiobookshelf server through its API with an API key
(Settings > API Keys in Audiobookshelf) and indexes each item's title, authors, series,
narrators and ISBN/ASIN. An item counts for the formats it holds: audiobook when it has
audio files, ebook when it has an ebook file, both for a combined item.

Paged ``GET /api/libraries/{id}/items?minified=1``, the listing the Audiobookshelf web
app uses. Nothing is written back.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

import requests

from shelfmark.core.config import config as app_config
from shelfmark.core.library_providers import LibraryEntry, setting
from shelfmark.core.logger import setup_logger
from shelfmark.core.text_match import isbn_variants, tokens

if TYPE_CHECKING:
    from collections.abc import Iterator, Mapping

logger = setup_logger(__name__)

_PAGE_SIZE = 500
_TIMEOUT_SECONDS = 30
_MAX_PAGES = 200  # 100,000 items per library; a guard against a server that never ends

# "Series Name #3, Other Series #1" as the minified listing gives it.
_SERIES_NUMBER = re.compile(r"\s*#[^,]*$")
# A trailing "(Unabridged)", "[Dramatized Adaptation]" and the like.
_PARENTHETICAL = re.compile(r"[(\[][^)\]]*[)\]]")


class AudiobookshelfError(RuntimeError):
    """The server could not be read."""


def normalize_narrator(name: str) -> str:
    """How narrator names are compared: casefolded, whitespace collapsed."""
    return " ".join(name.split()).casefold()


def _split_names(value: object) -> list[str]:
    return [name.strip() for name in str(value or "").split(",") if name.strip()]


def _series_names(value: object) -> list[str]:
    return [_SERIES_NUMBER.sub("", name) for name in _split_names(value)]


def entry_from_item(item: dict[str, Any]) -> LibraryEntry | None:
    """A matchable entry for one minified library item, or None when it holds no book."""
    media = item.get("media")
    if not isinstance(media, dict):
        return None
    metadata = media.get("metadata")
    if not isinstance(metadata, dict):
        return None
    title = str(metadata.get("title") or "").strip()
    if not title:
        return None

    content_types = set()
    if (media.get("numAudioFiles") or media.get("numTracks") or 0) > 0:
        content_types.add("audiobook")
    if media.get("ebookFormat"):
        content_types.add("ebook")
    if not content_types:
        return None  # an empty item: its files are missing

    title_tok = set(tokens(_PARENTHETICAL.sub(" ", title)))
    context_tok: set[str] = set()
    for name in [
        *_split_names(metadata.get("authorName")),
        *_series_names(metadata.get("seriesName")),
    ]:
        context_tok |= set(tokens(name))
    asin = str(metadata.get("asin") or "").strip().upper()
    return LibraryEntry(
        tokens=frozenset(title_tok | context_tok),
        isbns=isbn_variants(metadata.get("isbn")),
        asins=frozenset({asin} if asin else ()),
        title_tokens=frozenset(title_tok),
        context_tokens=frozenset(context_tok),
        content_types=frozenset(content_types),
        narrators=frozenset(
            normalize_narrator(name) for name in _split_names(metadata.get("narratorName"))
        ),
    )


def _base_url(overrides: Mapping[str, Any] | None) -> str:
    return str(setting(app_config, "ABS_URL", "", overrides) or "").strip().rstrip("/")


def _api_key(overrides: Mapping[str, Any] | None) -> str:
    return str(setting(app_config, "ABS_API_KEY", "", overrides) or "").strip()


def _library_ids(overrides: Mapping[str, Any] | None) -> set[str]:
    raw = setting(app_config, "ABS_LIBRARY_IDS", "", overrides)
    values = raw if isinstance(raw, (list, tuple)) else str(raw or "").split(",")
    return {str(value).strip() for value in values if str(value).strip()}


class AudiobookshelfLibrary:
    """Audiobook and ebook ownership via an Audiobookshelf server's API."""

    name = "audiobookshelf"
    display_name = "Audiobookshelf"
    content_types = frozenset({"audiobook", "ebook"})

    def __init__(self, overrides: Mapping[str, Any] | None = None) -> None:
        self._overrides = overrides

    def is_enabled(self) -> bool:
        return bool(
            setting(app_config, "LIBRARY_CHECK_ABS_ENABLED", False, self._overrides)
            and _base_url(self._overrides)
            and _api_key(self._overrides)
        )

    def describe(self) -> str:
        return f"Audiobookshelf at {_base_url(self._overrides) or '(no URL)'}"

    def fingerprint(self) -> None:
        return None  # No cheap change token; the cache TTL applies.

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        base = _base_url(self._overrides)
        key = _api_key(self._overrides)
        if not base or not key:
            msg = "Audiobookshelf URL and API key are required"
            raise AudiobookshelfError(msg)
        from shelfmark.download.network import get_proxies, get_ssl_verify

        url = f"{base}{path}"
        response = requests.get(
            url,
            params=params,
            headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
            timeout=_TIMEOUT_SECONDS,
            proxies=get_proxies(url),
            verify=get_ssl_verify(url),
        )
        if response.status_code in {401, 403}:
            msg = "Audiobookshelf rejected the API key"
            raise AudiobookshelfError(msg)
        response.raise_for_status()
        return response.json()

    def libraries(self) -> list[dict[str, Any]]:
        """The server's book libraries (podcast libraries are left out)."""
        data = self._get("/api/libraries")
        libraries = data.get("libraries") if isinstance(data, dict) else None
        return [
            lib
            for lib in libraries or []
            if isinstance(lib, dict) and lib.get("mediaType", "book") == "book" and lib.get("id")
        ]

    def _items(self, library_id: str) -> Iterator[dict[str, Any]]:
        for page in range(_MAX_PAGES):
            data = self._get(
                f"/api/libraries/{library_id}/items",
                {"limit": _PAGE_SIZE, "page": page, "minified": 1},
            )
            results = data.get("results") if isinstance(data, dict) else None
            if not isinstance(results, list) or not results:
                return
            yield from (item for item in results if isinstance(item, dict))
            if len(results) < _PAGE_SIZE:
                return

    def fetch_entries(self) -> list[LibraryEntry]:
        wanted = _library_ids(self._overrides)
        entries: list[LibraryEntry] = []
        for library in self.libraries():
            if wanted and str(library["id"]) not in wanted:
                continue
            for item in self._items(str(library["id"])):
                entry = entry_from_item(item)
                if entry is not None:
                    entries.append(entry)
        return entries
