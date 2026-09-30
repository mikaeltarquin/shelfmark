"""Decorators shared by route modules."""

from __future__ import annotations

from functools import wraps
from typing import TYPE_CHECKING, Any

from flask import jsonify, session

from shelfmark.core.auth_modes import load_active_auth_mode

if TYPE_CHECKING:
    from collections.abc import Callable

    from flask.typing import ResponseReturnValue


def admin_only(f: Callable[..., ResponseReturnValue]) -> Callable[..., ResponseReturnValue]:
    """Refuse non-admins (without login everyone is an admin)."""

    @wraps(f)
    def decorated(*args: Any, **kwargs: Any) -> ResponseReturnValue:
        if load_active_auth_mode() != "none":
            if "user_id" not in session:
                return jsonify({"error": "Authentication required"}), 401
            if not session.get("is_admin", False):
                return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)

    return decorated
