"""Tests for the MyAnonamouse account service and its /api/mam routes."""

from __future__ import annotations

import importlib
from typing import Any
from unittest.mock import patch

import pytest
import requests

from shelfmark.release_sources.prowlarr import mam_account
from shelfmark.release_sources.prowlarr.mam import MamAuthError

GIB = 1024**3

USER = {
    "username": "mouse",
    "classname": "Power User",
    "uploaded": "120.5 GiB",
    "downloaded": "40 GiB",
    "uploaded_bytes": int(120.5 * GIB),
    "downloaded_bytes": 40 * GIB,
    "ratio": "3.01",
    "seedbonus": "61,250",
    "vip_until": "2026-12-01 00:00:00",
}


class FakeMam:
    """Stands in for MamClient: records store requests and replays scripted replies."""

    def __init__(self, user: dict[str, Any] | Exception = USER, replies: list | None = None):
        self.user = user
        self.replies = list(replies or [])
        self.buys: list[dict[str, str]] = []

    def __call__(self, _mam_id: str) -> FakeMam:
        return self

    def get_user_data(self) -> dict[str, Any]:
        if isinstance(self.user, Exception):
            raise self.user
        return dict(self.user)

    def bonus_buy(self, params):
        self.buys.append({k: v for k, v in params.items() if k != "_"})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


@pytest.fixture
def mam(monkeypatch):
    fake = FakeMam()
    monkeypatch.setattr(mam_account, "MamClient", fake)
    monkeypatch.setattr(mam_account, "session_id", lambda: "session")
    mam_account.invalidate_stats()
    yield fake
    mam_account.invalidate_stats()


def _ok(amount: float, seedbonus: float) -> dict[str, Any]:
    return {"success": True, "amount": amount, "seedbonus": seedbonus}


class TestParsing:
    def test_stats_prefer_byte_counts(self):
        stats = mam_account.parse_stats(USER)
        assert stats.uploaded_bytes == int(120.5 * GIB)
        assert stats.buffer_bytes == int(80.5 * GIB)
        assert stats.ratio == pytest.approx(3.01)
        assert stats.seedbonus == 61250

    def test_stats_from_size_strings(self):
        stats = mam_account.parse_stats(
            {"uploaded": "1.5 TiB", "downloaded": "512 MiB", "ratio": "Inf.", "seedbonus": 10}
        )
        assert stats.uploaded_bytes == int(1.5 * 1024 * GIB)
        assert stats.downloaded_bytes == 512 * 1024**2
        assert stats.ratio == float("inf")
        assert stats.username is None

    @pytest.mark.parametrize(
        ("amount", "chunks"), [(50, [50]), (100, [100]), (250, [100, 100, 50]), (400, [100] * 4)]
    )
    def test_split_purchase(self, amount, chunks):
        assert mam_account.split_purchase(amount) == chunks

    @pytest.mark.parametrize("amount", [0, 25, 75, 49, 120.5, "abc", None, True, -50])
    def test_rejects_amounts(self, amount):
        with pytest.raises(ValueError):
            mam_account.parse_purchase_amount(amount)

    @pytest.mark.parametrize(("amount", "parsed"), [("150", 150), (200, 200), (" MAX ", "max")])
    def test_accepts_amounts(self, amount, parsed):
        assert mam_account.parse_purchase_amount(amount) == parsed


class TestStats:
    def test_cached_until_refresh(self, mam):
        assert mam_account.get_stats().username == "mouse"
        mam.user = {**USER, "username": "renamed"}
        assert mam_account.get_stats().username == "mouse"
        assert mam_account.get_stats(refresh=True).username == "renamed"

    def test_not_configured(self, mam, monkeypatch):
        monkeypatch.setattr(mam_account, "session_id", lambda: "")
        with pytest.raises(mam_account.MamNotConfiguredError):
            mam_account.get_stats()


class TestPurchase:
    def test_splits_into_store_sizes(self, mam):
        mam.replies = [_ok(100, 11250), _ok(100, 6250), _ok(50, 3750)]

        result = mam_account.purchase_upload_credit(250)

        assert result == mam_account.PurchaseResult(True, 250.0, 3750.0, None)
        assert [b["amount"] for b in mam.buys] == ["100", "100", "50"]
        assert all(b["spendtype"] == "upload" for b in mam.buys)

    def test_max_affordable_is_one_request(self, mam):
        mam.replies = [_ok(120, 12)]

        result = mam_account.purchase_upload_credit("max")

        assert result.success and result.amount_gb == 120
        assert mam.buys == [{"spendtype": "upload", "amount": "Max Affordable "}]

    def test_stops_at_first_rejection(self, mam):
        mam.replies = [_ok(100, 400), {"success": False, "error": "Not enough bonus points"}]

        result = mam_account.purchase_upload_credit(250)

        assert not result.success
        assert result.amount_gb == 100
        assert result.error == "Not enough bonus points"
        assert len(mam.buys) == 2

    def test_network_error_is_reported_not_raised(self, mam):
        mam.replies = [requests.exceptions.ConnectionError("reset")]

        result = mam_account.purchase_upload_credit(50)

        assert not result.success and result.amount_gb == 0
        assert result.error == (
            "Could not reach MyAnonamouse (network error); check Shelfmark's network and "
            "proxy settings"
        )

    def test_zero_added_is_a_failure(self, mam):
        mam.replies = [{"success": True, "amount": 0, "seedbonus": 10}]

        result = mam_account.purchase_upload_credit("max")

        assert not result.success
        assert "No upload credit" in (result.error or "")

    def test_purchase_refreshes_stats(self, mam):
        mam_account.get_stats()
        mam.user = {**USER, "seedbonus": "36250"}
        mam.replies = [_ok(50, 36250)]

        mam_account.purchase_upload_credit(50)

        assert mam_account.get_stats().seedbonus == 36250

    def test_invalid_amount_sends_nothing(self, mam):
        with pytest.raises(ValueError):
            mam_account.purchase_upload_credit(75)
        assert mam.buys == []


class TestConnectionStatus:
    def test_both_ok(self, mam):
        class Client:
            name = "qbittorrent"

            def test_connection(self):
                return True, "Connected to qBittorrent 5.1"

        with patch("shelfmark.download.clients.get_client", return_value=Client()):
            status = mam_account.connection_status()

        assert status["mam"] == {"configured": True, "ok": True, "message": "Connected as mouse"}
        assert status["torrent_client"] == {
            "configured": True,
            "ok": True,
            "name": "qBittorrent",
            "message": "Connected to qBittorrent 5.1",
        }

    def test_mam_rejected_and_no_client(self, mam):
        mam.user = MamAuthError("MyAnonamouse rejected the session ID (403)")
        with patch("shelfmark.download.clients.get_client", return_value=None):
            status = mam_account.connection_status()

        assert status["mam"]["ok"] is False
        assert "403" in status["mam"]["message"]
        assert status["torrent_client"]["configured"] is False


@pytest.fixture(scope="module")
def main_module():
    with patch("shelfmark.download.orchestrator.start"):
        import shelfmark.main as main

        importlib.reload(main)
        return main


def _client(main_module, *, is_admin: bool):
    client = main_module.app.test_client()
    with client.session_transaction() as sess:
        sess["user_id"] = "tester"
        sess["is_admin"] = is_admin
    return client


@pytest.fixture
def auth_required():
    with patch("shelfmark.core.mam_routes.load_active_auth_mode", return_value="builtin"):
        yield


class TestRoutes:
    def test_account(self, main_module, mam):
        resp = _client(main_module, is_admin=True).get("/api/mam/account")
        body = resp.get_json()
        assert resp.status_code == 200
        assert body["stats"]["username"] == "mouse"
        assert body["stats"]["buffer_bytes"] == int(80.5 * GIB)
        assert (body["points_per_gb"], body["step_gb"]) == (500, 50)

    def test_account_error_is_shown(self, main_module, mam):
        mam.user = MamAuthError("rejected (403)")
        body = _client(main_module, is_admin=True).get("/api/mam/account").get_json()
        assert body["configured"] is True and body["stats"] is None
        assert "403" in body["error"]

    def test_purchase(self, main_module, mam):
        mam.replies = [_ok(100, 11250)]
        resp = _client(main_module, is_admin=True).post(
            "/api/mam/upload-credit", json={"amount": 100}
        )
        body = resp.get_json()
        assert resp.status_code == 200
        assert body["success"] is True and body["amount_gb"] == 100
        assert body["stats"]["username"] == "mouse"

    def test_purchase_rejects_bad_amount(self, main_module, mam):
        resp = _client(main_module, is_admin=True).post(
            "/api/mam/upload-credit", json={"amount": 60}
        )
        assert resp.status_code == 400
        assert mam.buys == []

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("get", "/api/mam/account"),
            ("get", "/api/mam/status"),
            ("post", "/api/mam/upload-credit"),
        ],
    )
    def test_admin_only(self, main_module, mam, auth_required, method, path):
        client = _client(main_module, is_admin=False)
        resp = getattr(client, method)(path, json={"amount": 50})
        assert resp.status_code == 403
        assert mam.buys == []
