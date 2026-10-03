"""Library browser routes: the catalogue of owned books and their covers (admin only)."""

from __future__ import annotations

import re
import time
from typing import TYPE_CHECKING, Any

from flask import Response, jsonify, redirect, request, send_file

from shelfmark.core import library_catalog, library_index, library_missing
from shelfmark.core.library_providers.audiobookshelf import AudiobookshelfLibrary
from shelfmark.core.library_providers.calibre import CalibreLibrary
from shelfmark.core.logger import setup_logger
from shelfmark.core.route_guards import admin_only

if TYPE_CHECKING:
    from collections.abc import Callable

    from flask import Flask
    from flask.typing import ResponseReturnValue
    from werkzeug.wrappers import Response as BaseResponse

    from shelfmark.core.library_providers import LibraryEntry
    from shelfmark.metadata_providers import BookMetadata

logger = setup_logger(__name__)

_ITEM_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_COVER_CACHE_SECONDS = 24 * 3600
# Library cards look their book up when hovered, so answers are kept a while.
_LOOKUP_FOUND_SECONDS = 6 * 3600
_LOOKUP_MISSING_SECONDS = 10 * 60
_lookup_cache: dict[tuple[str, str, str], tuple[float, BookMetadata | None]] = {}


def _cached_provider_book(
    entry: LibraryEntry, source: str, item_id: str, content_type: str
) -> BookMetadata | None:
    key = (source, item_id, content_type)
    cached = _lookup_cache.get(key)
    if cached is not None:
        at, book = cached
        ttl = _LOOKUP_FOUND_SECONDS if book is not None else _LOOKUP_MISSING_SECONDS
        if time.monotonic() - at < ttl:
            return book
    book = library_catalog.find_provider_book(entry, content_type)
    _lookup_cache[key] = (time.monotonic(), book)
    return book


def _cached(response: BaseResponse) -> BaseResponse:
    response.headers["Cache-Control"] = f"private, max-age={_COVER_CACHE_SECONDS}"
    return response


def library_cover(source: str, item_id: str) -> ResponseReturnValue:
    """One library item's cover: from the library, else from the metadata provider."""
    if not _ITEM_ID.match(item_id):
        return jsonify({"error": "Invalid item id"}), 400
    found = library_catalog.find_entry(source, item_id)
    if found is None:
        return jsonify({"error": "Not in the library"}), 404
    provider, entry = found
    item = entry.item
    if item is not None and item.has_cover:
        try:
            if isinstance(provider, AudiobookshelfLibrary):
                data, content_type = provider.cover(item_id)
                return _cached(Response(data, mimetype=content_type))
            if isinstance(provider, CalibreLibrary):
                path = provider.cover_path(item_id)
                if path is not None:
                    return _cached(send_file(path, mimetype="image/jpeg"))
        except Exception as exc:  # noqa: BLE001 - fall back to the metadata provider
            logger.debug("Library cover for %s:%s unavailable: %s", source, item_id, exc)
    url = library_catalog.provider_cover_url(provider, entry)
    if url:
        return _cached(redirect(url, code=302))
    return jsonify({"error": "No cover"}), 404


def register_library_routes(app: Flask, login_required: Callable[..., Any]) -> None:
    """Register the /api/library/* routes."""

    @app.route("/api/library/books", methods=["GET"])
    @login_required
    @admin_only
    def api_library_books() -> ResponseReturnValue:
        providers = library_index.enabled_providers()
        return jsonify(
            {
                "enabled": bool(providers),
                "sources": [{"name": p.name, "display_name": p.display_name} for p in providers],
                "books": [book.to_dict() for book in library_catalog.catalog()],
            }
        )

    @app.route("/api/library/cover/<source>/<item_id>", methods=["GET"])
    @login_required
    @admin_only
    def api_library_cover(source: str, item_id: str) -> ResponseReturnValue:
        return library_cover(source, item_id)

    @app.route("/api/library/files/<source>/<item_id>", methods=["GET"])
    @login_required
    @admin_only
    def api_library_files(source: str, item_id: str) -> ResponseReturnValue:
        """One library item's files, for the book details' library section."""
        if not _ITEM_ID.match(item_id):
            return jsonify({"error": "Invalid item id"}), 400
        found = library_catalog.find_entry(source, item_id)
        if found is None:
            return jsonify({"error": "Not in the library"}), 404
        provider, _entry = found
        if not isinstance(provider, (AudiobookshelfLibrary, CalibreLibrary)):
            return jsonify({"files": []})
        try:
            files = provider.item_files(item_id)
        except Exception as exc:  # noqa: BLE001 - shown on the page
            logger.warning("Files of %s:%s unavailable: %s", source, item_id, exc)
            return jsonify({"error": f"{provider.display_name} could not be read: {exc}"}), 502
        return jsonify(
            {
                "files": [
                    {"name": f.name, "path": f.path, "kind": f.kind, "size": f.size} for f in files
                ]
            }
        )

    @app.route("/api/library/holdings", methods=["POST"])
    @login_required
    @admin_only
    def api_library_holdings() -> ResponseReturnValue:
        """The library copies of a book, from what the client knows of it.

        For the book details wherever they open (a library card, an Activity row, a
        search result), so they can list the copies without asking the metadata
        provider again. Matched the same way search results are marked.
        """
        from shelfmark.metadata_providers import BookMetadata

        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"error": "A book is required"}), 400
        title = str(data.get("title") or "").strip()
        if not title:
            return jsonify({"error": "A title is required"}), 400

        def text(key: str) -> str | None:
            value = data.get(key)
            return str(value).strip() or None if value is not None else None

        authors = data.get("authors")
        book = BookMetadata(
            provider=text("provider") or "",
            provider_id=text("provider_id") or "",
            title=title,
            authors=[str(a) for a in authors if str(a).strip()]
            if isinstance(authors, list)
            else [],
            isbn_10=text("isbn_10"),
            isbn_13=text("isbn_13"),
            search_title=text("search_title"),
            search_author=text("search_author"),
        )
        try:
            rows = library_index.holdings_with_links(book)
        except Exception as exc:  # noqa: BLE001 - the library check fails open
            logger.warning("Could not list library holdings: %s", exc)
            rows = []
        return jsonify({"holdings": rows})

    @app.route("/api/library/missing", methods=["GET"])
    @login_required
    @admin_only
    def api_library_missing() -> ResponseReturnValue:
        kind = request.args.get("kind", "")
        name = request.args.get("name", "").strip()
        content_type = request.args.get("content_type", "ebook")
        if kind not in {"author", "series"} or not name:
            return jsonify({"error": "kind (author or series) and name are required"}), 400
        if content_type not in {"ebook", "audiobook"}:
            content_type = "ebook"
        include_compilations = request.args.get("collections") == "1"
        try:
            return jsonify(
                library_missing.candidates(
                    kind, name, content_type, include_compilations=include_compilations
                )
            )
        except Exception as exc:  # noqa: BLE001 - shown on the page
            logger.warning("Missing books for %s %s failed: %s", kind, name, exc)
            return jsonify({"error": f"The metadata provider could not be reached: {exc}"}), 502

    @app.route("/api/library/lookup/<source>/<item_id>", methods=["GET"])
    @login_required
    @admin_only
    def api_library_lookup(source: str, item_id: str) -> ResponseReturnValue:
        """The metadata provider's record of a library book, to get another copy of it."""
        if not _ITEM_ID.match(item_id):
            return jsonify({"error": "Invalid item id"}), 400
        content_type = request.args.get("content_type", "ebook")
        if content_type not in {"ebook", "audiobook"}:
            content_type = "ebook"
        found = library_catalog.find_entry(source, item_id)
        if found is None:
            return jsonify({"error": "Not in the library"}), 404
        _provider, entry = found
        try:
            book = _cached_provider_book(entry, source, item_id, content_type)
        except Exception as exc:  # noqa: BLE001 - shown on the page
            logger.warning("Lookup of %s:%s failed: %s", source, item_id, exc)
            return jsonify({"error": f"The metadata provider could not be reached: {exc}"}), 502
        if book is None:
            title = entry.item.title if entry.item else "this book"
            return jsonify({"error": f"Could not find {title} with the metadata provider"}), 404
        return jsonify({"book": library_missing.book_dict(book)})
