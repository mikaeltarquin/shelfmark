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


def _payload_list(raw: object) -> list[dict[str, Any]] | None:
    """Download payloads from a request body, or None when the body has none."""
    if raw is None:
        return None
    if not isinstance(raw, list) or not all(isinstance(p, dict) for p in raw):
        msg = "payloads must be a list of objects"
        raise ValueError(msg)
    return raw


def register_saved_routes(
    app: Flask,
    service: SavedItemsService,
    login_required: Callable[..., Any],
    resolve_auth_mode: Callable[[], str],
    on_auto_get: Callable[[], None] | None = None,
) -> None:
    """Register the saved items API; `on_auto_get` runs when an item is marked."""

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
                payloads=_payload_list(data.get("payloads")) if releases else None,
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify(item), 201

    @app.route("/api/saved/<int:item_id>", methods=["PATCH"])
    @login_required
    def api_saved_update(item_id: int) -> Response | tuple[Response, int]:
        owner = _owner(resolve_auth_mode)
        if owner is None:
            return _no_owner()
        item = service.get_item(owner, item_id)
        if item is None:
            return jsonify({"error": "Not found"}), 404
        data = request.get_json(silent=True) or {}
        try:
            payloads = _payload_list(data.get("payloads"))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        if payloads is not None and len(payloads) != len(item["releases"]):
            return jsonify({"error": "payloads must match the releases one for one"}), 400
        auto_get = data.get("auto_get")
        if auto_get is not None and not isinstance(auto_get, bool):
            return jsonify({"error": "auto_get must be true or false"}), 400
        if auto_get:
            if not item["releases"]:
                return jsonify({"error": "Pick a release before getting it automatically"}), 400
            if payloads is None and not item["has_payloads"]:
                return jsonify({"error": "payloads are needed to get it automatically"}), 400
        conditions = data.get("conditions")
        if conditions is not None and not isinstance(conditions, dict):
            return jsonify({"error": "conditions must be an object"}), 400
        updated = service.update(
            owner,
            item_id,
            auto_get=auto_get,
            conditions=conditions,
            payloads=payloads,
            clear_error=bool(auto_get),
        )
        if updated and updated["auto_get"] and on_auto_get is not None:
            on_auto_get()
        return jsonify(updated)

    @app.route("/api/saved/<int:item_id>", methods=["DELETE"])
    @login_required
    def api_saved_delete(item_id: int) -> Response | tuple[Response, int]:
        owner = _owner(resolve_auth_mode)
        if owner is None:
            return _no_owner()
        if not service.delete(owner, item_id):
            return jsonify({"error": "Not found"}), 404
        return jsonify({"deleted": True})
