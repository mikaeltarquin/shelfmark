"""Library browser routes: the catalogue of owned books and their covers (admin only)."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from flask import Response, jsonify, redirect, send_file

from shelfmark.core import library_catalog, library_index
from shelfmark.core.library_providers.audiobookshelf import AudiobookshelfLibrary
from shelfmark.core.library_providers.calibre import CalibreLibrary
from shelfmark.core.logger import setup_logger
from shelfmark.core.route_guards import admin_only

if TYPE_CHECKING:
    from collections.abc import Callable

    from flask import Flask
    from flask.typing import ResponseReturnValue
    from werkzeug.wrappers import Response as BaseResponse

logger = setup_logger(__name__)

_ITEM_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_COVER_CACHE_SECONDS = 24 * 3600


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
