"""MyAnonamouse account routes: stats, connection status and upload credit purchases.

Admin only: every Shelfmark user shares the one MAM account, and a purchase spends
its bonus points.
"""

from __future__ import annotations

from dataclasses import asdict
from functools import wraps
from typing import TYPE_CHECKING, Any

from flask import jsonify, request, session

from shelfmark.core.auth_modes import load_active_auth_mode
from shelfmark.core.logger import setup_logger
from shelfmark.release_sources.prowlarr import mam_account, mam_autobuy, mam_points

if TYPE_CHECKING:
    from collections.abc import Callable

    from flask import Flask, Response
    from flask.typing import ResponseReturnValue

logger = setup_logger(__name__)


def _admin_only(f: Callable[..., ResponseReturnValue]) -> Callable[..., ResponseReturnValue]:
    @wraps(f)
    def decorated(*args: Any, **kwargs: Any) -> ResponseReturnValue:
        if load_active_auth_mode() != "none":
            if "user_id" not in session:
                return jsonify({"error": "Authentication required"}), 401
            if not session.get("is_admin", False):
                return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)

    return decorated


def _account_payload(*, refresh: bool) -> dict[str, Any]:
    if not mam_account.is_configured():
        return {"configured": False, "stats": None, "error": None}
    try:
        stats = mam_account.get_stats(refresh=refresh)
    except mam_account.MAM_ERRORS as exc:
        return {"configured": True, "stats": None, "error": mam_account.describe_error(exc)}
    return {
        "configured": True,
        "stats": stats.to_dict(),
        "error": None,
        "points_per_hour": mam_points.estimate_rate(),
    }


def _is_admin() -> bool:
    return load_active_auth_mode() == "none" or bool(session.get("is_admin", False))


def buffer_check_payload(releases: list[dict[str, Any]]) -> dict[str, Any]:
    """Buffer check result for the current user; bonus points are shown to admins only."""
    result = mam_account.check_buffer(releases).to_dict()
    can_buy = _is_admin()
    if not can_buy:
        result["seedbonus"] = None
    return {**result, "can_buy": can_buy}


def register_mam_routes(app: Flask, login_required: Callable[..., Any]) -> None:
    """Register the /api/mam/* routes."""

    @app.route("/api/mam/account", methods=["GET"])
    @login_required
    @_admin_only
    def api_mam_account() -> Response | tuple[Response, int]:
        refresh = request.args.get("refresh", "").lower() in {"1", "true", "yes"}
        return jsonify(
            {
                **_account_payload(refresh=refresh),
                "points_per_gb": mam_account.UPLOAD_CREDIT_POINTS_PER_GB,
                "step_gb": mam_account.UPLOAD_CREDIT_STEP_GB,
            }
        )

    @app.route("/api/mam/ratio", methods=["GET"])
    @login_required
    def api_mam_ratio() -> Response:
        # Every user: they all download on the one account. No username or points.
        return jsonify(mam_account.ratio_snapshot())

    @app.route("/api/mam/buffer-check", methods=["POST"])
    @login_required
    def api_mam_buffer_check() -> Response | tuple[Response, int]:
        data = request.get_json(silent=True) or {}
        releases = data.get("releases")
        if not isinstance(releases, list):
            return jsonify({"error": "releases must be a list"}), 400
        return jsonify(buffer_check_payload([r for r in releases if isinstance(r, dict)]))

    @app.route("/api/mam/autobuy", methods=["GET"])
    @login_required
    @_admin_only
    def api_mam_autobuy() -> Response:
        settings = mam_autobuy.load_settings()
        return jsonify(
            {
                "settings": asdict(settings),
                "last_check": mam_autobuy.last_report(),
                "history": mam_autobuy.load_history()[:10],
            }
        )

    @app.route("/api/mam/autobuy/run", methods=["POST"])
    @login_required
    @_admin_only
    def api_mam_autobuy_run() -> Response:
        report = mam_autobuy.run_check("manual")
        return jsonify({"last_check": report.to_dict(), "history": mam_autobuy.load_history()[:10]})

    @app.route("/api/mam/status", methods=["GET"])
    @login_required
    @_admin_only
    def api_mam_status() -> Response:
        return jsonify(mam_account.connection_status())

    @app.route("/api/mam/upload-credit", methods=["POST"])
    @login_required
    @_admin_only
    def api_mam_buy_upload_credit() -> Response | tuple[Response, int]:
        data = request.get_json(silent=True) or {}
        try:
            amount = mam_account.parse_purchase_amount(data.get("amount"))
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400
        if not mam_account.is_configured():
            return jsonify({"success": False, "error": "No MAM session ID is set"}), 400

        # "download": bought from the buffer prompt before downloading.
        reason = "download" if data.get("reason") == "download" else "manual"
        result = mam_autobuy.buy(amount, reason=reason)
        payload: dict[str, Any] = {
            "success": result.success,
            "amount_gb": result.amount_gb,
            "seedbonus": result.seedbonus,
            "error": result.error,
            **_account_payload(refresh=True),
        }
        # 200 either way: a purchase MAM declines is reported in the body, with any
        # amount already bought before it stopped.
        return jsonify(payload)
