"""Saved for later: each user's list of books (and picked releases) to download later."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from flask import Response, jsonify, request, session

from shelfmark.core.logger import setup_logger
from shelfmark.core.request_helpers import get_session_db_user_id
from shelfmark.core.saved_items import NOAUTH_OWNER, SavedItemsService, user_owner

if TYPE_CHECKING:
    from collections.abc import Callable

    from flask import Flask

logger = setup_logger(__name__)


def _owner(resolve_auth_mode: Callable[[], str]) -> str | None:
    """Whose list this request reads: the signed-in user's, or the shared one with no login."""
    if resolve_auth_mode() == "none":
        return NOAUTH_OWNER
    user_id = get_session_db_user_id(session)
    return user_owner(user_id) if user_id and user_id > 0 else None


def _no_owner() -> tuple[Response, int]:
    return jsonify({"error": "Saved items need a signed-in user"}), 403


def register_saved_routes(
    app: Flask,
    service: SavedItemsService,
    login_required: Callable[..., Any],
    resolve_auth_mode: Callable[[], str],
) -> None:
    """Register the saved items API."""

    @app.route("/api/saved", methods=["GET"])
    @login_required
    def api_saved_list() -> Response | tuple[Response, int]:
        owner = _owner(resolve_auth_mode)
        if owner is None:
            return _no_owner()
        return jsonify({"items": service.list_items(owner)})

    @app.route("/api/saved", methods=["POST"])
    @login_required
    def api_saved_create() -> Response | tuple[Response, int]:
        owner = _owner(resolve_auth_mode)
        if owner is None:
            return _no_owner()
        data = request.get_json(silent=True) or {}
        book = data.get("book")
        releases = data.get("releases") or []
        if not isinstance(book, dict) or not isinstance(releases, list):
            return jsonify({"error": "book must be an object and releases a list"}), 400
        try:
            item = service.save(
                owner,
                book=book,
                content_type=str(data.get("content_type") or "ebook"),
                releases=releases,
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify(item), 201

    @app.route("/api/saved/<int:item_id>", methods=["DELETE"])
    @login_required
    def api_saved_delete(item_id: int) -> Response | tuple[Response, int]:
        owner = _owner(resolve_auth_mode)
        if owner is None:
            return _no_owner()
        if not service.delete(owner, item_id):
            return jsonify({"error": "Not found"}), 404
        return jsonify({"deleted": True})
