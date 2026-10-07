"""Tests for the MyAnonamouse account service and its /api/mam routes."""

from __future__ import annotations

import importlib
import time
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
def mam(monkeypatch, tmp_path):
    from shelfmark.release_sources.prowlarr import mam_points

    monkeypatch.setattr(mam_points, "_path", lambda: tmp_path / "points.json")
    fake = FakeMam()
    monkeypatch.setattr(mam_account, "MamClient", fake)
    monkeypatch.setattr(mam_account, "session_id", lambda: "session")
    mam_account.invalidate_stats()
    yield fake
    mam_account.invalidate_stats()


def _ok(amount: float, seedbonus: float) -> dict[str, Any]:
    return {"success": True, "amount": amount, "seedbonus": seedbonus}


class TestParsing:
    def test_stats_carry_the_user_id_for_the_profile_link(self):
        assert mam_account.parse_stats({**USER, "uid": 123456}).uid == 123456
        assert mam_account.parse_stats({**USER, "uid": "123456"}).uid == 123456
        assert mam_account.parse_stats(USER).uid is None

    def test_stats_prefer_byte_counts(self):
        stats = mam_account.parse_stats(USER)
        assert stats.uploaded_bytes == int(120.5 * GIB)
        assert stats.buffer_bytes == int(80.5 * GIB)
        assert stats.ratio == pytest.approx(120.5 / 40)
        assert stats.seedbonus == 61250

    def test_ratio_from_byte_counts_is_finer_than_the_ratio_text(self):
        stats = mam_account.parse_stats(
            {**USER, "uploaded_bytes": 133 * GIB, "downloaded_bytes": 100 * GIB, "ratio": "1.3"}
        )
        assert stats.ratio == pytest.approx(1.33)

    def test_ratio_text_when_nothing_downloaded(self):
        stats = mam_account.parse_stats({**USER, "downloaded_bytes": 0, "ratio": "Inf."})
        assert stats.ratio == float("inf")

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
    with (
        patch("shelfmark.core.mam_routes.load_active_auth_mode", return_value="builtin"),
        patch("shelfmark.core.route_guards.load_active_auth_mode", return_value="builtin"),
    ):
        yield


class TestRoutes:
    def test_account(self, main_module, mam):
        resp = _client(main_module, is_admin=True).get("/api/mam/account")
        body = resp.get_json()
        assert resp.status_code == 200
        assert body["stats"]["username"] == "mouse"
        assert body["stats"]["buffer_bytes"] == int(80.5 * GIB)
        assert (body["points_per_gb"], body["step_gb"]) == (500, 50)
        # Room before the ratio drops below Keep Ratio At Least (2.0): 120.5 / 2 - 40
        assert body["keep_ratio"] == 2.0
        assert body["room_bytes"] == int(20.25 * GIB)

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
            ("post", "/api/mam/freeze"),
            ("delete", "/api/mam/freeze"),
        ],
    )
    def test_admin_only(self, main_module, mam, auth_required, method, path):
        client = _client(main_module, is_admin=False)
        resp = getattr(client, method)(path, json={"amount": 50})
        assert resp.status_code == 403
        assert mam.buys == []

    def test_freeze_entered_and_cleared_by_hand(self, main_module, mam, monkeypatch):
        from shelfmark.release_sources.prowlarr import mam_freeze

        client = _client(main_module, is_admin=True)
        assert client.post("/api/mam/freeze", json={"remaining": "soon"}).status_code == 400
        resp = client.post("/api/mam/freeze", json={"remaining": "1d 02:04:02"})
        assert resp.status_code == 200
        assert resp.get_json()["frozen_source"] == "manual"
        assert mam_freeze.remaining_seconds() > 26 * 3600
        resp = client.delete("/api/mam/freeze")
        assert resp.get_json()["frozen_seconds"] is None
        assert mam_freeze.current() is None


def _mam_release(gib: float, *, freeleech: bool = False, torrent_id: int | None = 123) -> dict:
    return {
        "source": "prowlarr",
        "source_id": f"guid-{gib}",
        "title": "Book",
        "size_bytes": int(gib * GIB),
        "extra": {"mam_torrent_id": torrent_id, "freeleech": freeleech},
    }


class TestCharge:
    def test_mam_release_is_charged_its_size(self):
        from shelfmark.release_sources.prowlarr.mam_charge import mam_charge_bytes_for_release

        assert mam_charge_bytes_for_release(_mam_release(1.5)) == int(1.5 * GIB)
        assert mam_charge_bytes_for_release(_mam_release(1.5, freeleech=True)) == 0
        assert mam_charge_bytes_for_release(_mam_release(1.5, torrent_id=None)) == 0
        assert mam_charge_bytes_for_release({"size_bytes": GIB}) == 0


@pytest.fixture
def no_pending(monkeypatch):
    monkeypatch.setattr(mam_account, "pending_charge_bytes", lambda: 0)


class TestBufferCheck:
    def test_fits(self, mam, no_pending):
        result = mam_account.check_buffer([_mam_release(30), _mam_release(40)])
        assert result.ok and result.checked
        assert result.buffer_bytes == int(80.5 * GIB)

    def test_too_big_recommends_the_smallest_covering_purchase(self, mam, no_pending):
        result = mam_account.check_buffer([_mam_release(60), _mam_release(40)])

        assert not result.ok
        assert result.missing_bytes == int(100 * GIB) - int(80.5 * GIB)
        assert (result.recommended_gb, result.recommended_cost) == (50, 25000)
        assert result.seedbonus == 61250

    def test_active_downloads_count(self, mam, monkeypatch):
        monkeypatch.setattr(mam_account, "pending_charge_bytes", lambda: 60 * GIB)

        result = mam_account.check_buffer([_mam_release(30)])

        assert not result.ok
        assert result.pending_bytes == 60 * GIB
        assert result.recommended_gb == 50

    def test_freeleech_and_other_indexers_skip_the_check(self, mam, no_pending):
        mam.user = MamAuthError("should not be asked")
        result = mam_account.check_buffer(
            [_mam_release(500, freeleech=True), _mam_release(500, torrent_id=None)]
        )
        assert result.ok and not result.checked

    def test_fails_open_when_mam_is_unreachable(self, mam, no_pending):
        mam.user = requests.exceptions.ConnectionError("down")

        result = mam_account.check_buffer([_mam_release(500)])

        assert result.ok and not result.checked
        assert "Could not reach MyAnonamouse" in (result.error or "")

    def test_off_when_disabled(self, mam, no_pending, monkeypatch):
        monkeypatch.setattr(mam_account, "buffer_check_enabled", lambda: False)
        assert mam_account.check_buffer([_mam_release(500)]).ok

    def test_recommended_purchase(self):
        assert mam_account.recommended_purchase_gb(1) == 50
        assert mam_account.recommended_purchase_gb(50 * GIB) == 50
        assert mam_account.recommended_purchase_gb(50 * GIB + 1) == 100

    def test_pending_counts_only_active_tasks(self, monkeypatch):
        from shelfmark.core.models import DownloadTask, QueueStatus
        from shelfmark.core.queue import book_queue

        def task(task_id: str, charge: int | None) -> DownloadTask:
            return DownloadTask(
                task_id=task_id, source="prowlarr", title="T", mam_charge_bytes=charge
            )

        status = {s: {} for s in QueueStatus}
        status[QueueStatus.QUEUED] = {"a": task("a", 2 * GIB)}
        status[QueueStatus.DOWNLOADING] = {"b": task("b", 3 * GIB), "c": task("c", None)}
        status[QueueStatus.COMPLETE] = {"d": task("d", 50 * GIB)}
        monkeypatch.setattr(book_queue, "get_status", lambda: status)

        assert mam_account.pending_charge_bytes() == 5 * GIB


class TestQueueRecordsCharge:
    def test_queued_mam_task_carries_its_charge(self, monkeypatch):
        from shelfmark.download import orchestrator

        captured = {}
        monkeypatch.setattr(orchestrator.config, "get", lambda _k, default=None, **_kw: default)
        monkeypatch.setattr(orchestrator, "_source_unavailable_message", lambda _s: None)
        monkeypatch.setattr(orchestrator.book_queue, "add", lambda t: captured.setdefault("t", t))
        monkeypatch.setattr(orchestrator, "ws_manager", None)

        ok, _error = orchestrator.queue_release({**_mam_release(2), "content_type": "audiobook"}, 0)

        assert ok
        task = captured["t"]
        assert task.mam_charge_bytes == 2 * GIB
        restored = orchestrator._restore_task_from_retry_payload(
            orchestrator.serialize_task_for_retry(task)
        )
        assert restored is not None and restored.mam_charge_bytes == 2 * GIB

    def test_queued_task_remembers_its_book(self, monkeypatch):
        from shelfmark.download import orchestrator

        captured = {}
        monkeypatch.setattr(orchestrator.config, "get", lambda _k, default=None, **_kw: default)
        monkeypatch.setattr(orchestrator, "_source_unavailable_message", lambda _s: None)
        monkeypatch.setattr(orchestrator.book_queue, "add", lambda t: captured.setdefault("t", t))
        monkeypatch.setattr(orchestrator, "ws_manager", None)

        release = {**_mam_release(2), "content_type": "audiobook", "book_key": " hardcover:42 "}
        ok, _error = orchestrator.queue_release(release, 0)

        assert ok
        task = captured["t"]
        assert task.book_key == "hardcover:42"
        assert orchestrator._task_to_dict(task)["book_key"] == "hardcover:42"
        restored = orchestrator._restore_task_from_retry_payload(
            orchestrator.serialize_task_for_retry(task)
        )
        assert restored is not None and restored.book_key == "hardcover:42"

    def test_queued_task_keeps_the_release_page_not_a_download_link(self, monkeypatch):
        from shelfmark.download import orchestrator

        captured = {}
        monkeypatch.setattr(orchestrator.config, "get", lambda _k, default=None, **_kw: default)
        monkeypatch.setattr(orchestrator, "_source_unavailable_message", lambda _s: None)
        monkeypatch.setattr(orchestrator.book_queue, "add", lambda t: captured.setdefault("t", t))
        monkeypatch.setattr(orchestrator, "ws_manager", None)

        page = "https://www.myanonamouse.net/t/555"
        ok, _ = orchestrator.queue_release({**_mam_release(2), "info_url": page}, 0)
        assert ok
        task = captured["t"]
        assert task.info_url == page
        restored = orchestrator._restore_task_from_retry_payload(
            orchestrator.serialize_task_for_retry(task)
        )
        assert restored is not None and restored.info_url == page

        captured.clear()
        ok, _ = orchestrator.queue_release({**_mam_release(3), "info_url": "magnet:?xt=x"}, 0)
        assert ok and captured["t"].info_url is None
        # Without a page, a MAM torrent links to its page by id.
        assert orchestrator._task_to_dict(captured["t"])["info_url"].startswith(
            "https://www.myanonamouse.net/t/"
        )


class TestRatioAndBufferRoutes:
    def test_ratio_hides_account_details(self, main_module, mam, no_pending, auth_required):
        body = _client(main_module, is_admin=False).get("/api/mam/ratio").get_json()
        assert body["available"] is True
        assert body["buffer_bytes"] == int(80.5 * GIB)
        assert body["warning_ratio"] == 2.0
        assert "username" not in body and "seedbonus" not in body

    def test_buffer_check_offers_purchase_to_admins_only(
        self, main_module, mam, no_pending, auth_required
    ):
        payload = {"releases": [_mam_release(100)]}
        admin = _client(main_module, is_admin=True).post("/api/mam/buffer-check", json=payload)
        user = _client(main_module, is_admin=False).post("/api/mam/buffer-check", json=payload)

        assert admin.get_json()["ok"] is False and admin.get_json()["can_buy"] is True
        assert admin.get_json()["seedbonus"] == 61250
        assert user.get_json()["can_buy"] is False and user.get_json()["seedbonus"] is None

    def test_download_route_refuses_a_release_over_the_buffer(self, main_module, mam, no_pending):
        with patch.object(main_module.backend, "queue_release") as queue_release:
            resp = _client(main_module, is_admin=True).post(
                "/api/releases/download", json={**_mam_release(100), "content_type": "audiobook"}
            )

        assert resp.status_code == 409
        assert resp.get_json()["code"] == "insufficient_mam_buffer"
        assert resp.get_json()["recommended_gb"] == 50
        queue_release.assert_not_called()

    def test_download_route_queues_a_release_that_fits(self, main_module, mam, no_pending):
        with patch.object(main_module.backend, "queue_release", return_value=(True, None)) as q:
            resp = _client(main_module, is_admin=True).post(
                "/api/releases/download", json={**_mam_release(10), "content_type": "audiobook"}
            )

        assert resp.status_code == 200
        q.assert_called_once()


def _unsat_user(count: int, limit: int, *, nested: bool = True) -> dict:
    unsat = {"name": "Unsatisfied", "count": count, "limit": limit, "size": None}
    return {**USER, "snatch_summary": {"unsat": unsat}} if nested else {**USER, "unsat": unsat}


class SimpleTask:
    def __init__(self, task_id: str, mam_torrent_id: int | None) -> None:
        self.task_id = task_id
        self.mam_torrent_id = mam_torrent_id


@pytest.fixture(autouse=True)
def no_unsat_readings(monkeypatch):
    """Each test starts with no record of MAM's unsatisfied count."""
    monkeypatch.setattr(mam_account, "_unsat_samples", [])


class TestUnsatisfied:
    @pytest.mark.parametrize("nested", [True, False])
    def test_parsed_from_either_shape(self, nested):
        stats = mam_account.parse_stats(_unsat_user(87, 100, nested=nested))
        assert (stats.unsat_count, stats.unsat_limit) == (87, 100)

    def test_missing_summary(self):
        stats = mam_account.parse_stats(USER)
        assert (stats.unsat_count, stats.unsat_limit) == (None, None)

    def test_blocks_when_slots_to_keep_free_would_be_used(self, mam, no_pending, monkeypatch):
        monkeypatch.setattr(mam_account, "pending_unsat_count", lambda *_: 0)
        mam.user = _unsat_user(94, 100)

        one = mam_account.check_buffer([_mam_release(1)])
        two = mam_account.check_buffer([_mam_release(1), _mam_release(2)])

        assert one.ok and one.unsat_ok  # 95 <= 100 - 5
        assert not two.ok and not two.unsat_ok and two.buffer_ok
        assert (two.unsat_count, two.unsat_limit, two.unsat_reserve) == (94, 100, 5)

    def test_freeleech_counts_and_queued_downloads_count(self, mam, no_pending, monkeypatch):
        monkeypatch.setattr(mam_account, "pending_unsat_count", lambda *_: 3)
        mam.user = _unsat_user(92, 100)

        result = mam_account.check_buffer([_mam_release(1, freeleech=True)])

        assert not result.unsat_ok  # 92 + 3 queued + 1 > 95
        assert result.unsat_pending == 3 and result.request_bytes == 0

    def test_off_or_no_limit_reported(self, mam, no_pending, monkeypatch):
        monkeypatch.setattr(mam_account, "pending_unsat_count", lambda *_: 0)
        mam.user = USER
        assert mam_account.check_buffer([_mam_release(1)]).unsat_ok
        mam.user = _unsat_user(100, 100)
        monkeypatch.setattr(mam_account, "unsat_check_enabled", lambda: False)
        assert mam_account.check_buffer([_mam_release(1)]).ok

    def test_pending_counts_only_queued_mam_tasks(self, monkeypatch):
        from shelfmark.core.models import DownloadTask, QueueStatus
        from shelfmark.core.queue import book_queue

        def task(task_id: str, mam_id: int | None) -> DownloadTask:
            return DownloadTask(
                task_id=task_id, source="prowlarr", title="T", mam_torrent_id=mam_id
            )

        status = {s: {} for s in QueueStatus}
        status[QueueStatus.QUEUED] = {"a": task("a", 1), "b": task("b", None)}
        status[QueueStatus.RESOLVING] = {"c": task("c", 2)}
        status[QueueStatus.DOWNLOADING] = {"d": task("d", 3)}  # already in MAM's count
        monkeypatch.setattr(book_queue, "get_status", lambda: status)
        monkeypatch.setattr(book_queue, "handoff_times_since", lambda _since: [])

        assert mam_account.pending_unsat_count() == 2

    def test_pending_counts_snatches_since_the_stats_were_read(self):
        """A torrent handed to the client after (or just before) the stats were read is
        not in MAM's count yet, even once it has finished: small ebooks finish in
        seconds, and counting them as done let a run queue past the limit."""
        from shelfmark.core.models import DownloadTask, QueueStatus
        from shelfmark.core.queue import BookQueue

        queue = BookQueue()
        for task_id, mam_id in (("e1", 1), ("e2", 2), ("other", None)):
            queue.add(
                DownloadTask(task_id=task_id, source="prowlarr", title="T", mam_torrent_id=mam_id)
            )
        before = time.time()
        for task_id in ("e1", "e2", "other"):
            queue.update_status(task_id, QueueStatus.DOWNLOADING)
        queue.update_status("e1", QueueStatus.COMPLETE)

        with patch("shelfmark.core.queue.book_queue", queue):
            assert mam_account.pending_unsat_count(before) == 2
            # Long after the handoffs (past the lag allowance), MAM's count has them.
            assert mam_account.pending_unsat_count(before + 3600) == 0

    def test_free_slots_count_recent_snatches_but_not_the_asker(self, mam, monkeypatch):
        from shelfmark.core.queue import book_queue

        mam.user = _unsat_user(90, 100)
        monkeypatch.setattr(mam_account, "unsat_reserve_slots", lambda: 3)
        snatched = [
            SimpleTask("a", 1),
            SimpleTask("asker", 2),
            SimpleTask("not-mam", None),
        ]
        monkeypatch.setattr(
            book_queue, "handoff_times_since", lambda _since: [(time.time(), t) for t in snatched]
        )
        # 100 - 3 kept free - 90 - "a" (the asker doesn't count against itself)
        assert mam_account.unsat_free_slots(exclude={"asker"}) == 6
        monkeypatch.setattr(mam_account, "unsat_check_enabled", lambda: False)
        assert mam_account.unsat_free_slots() is None

    def test_download_route_queues_a_download_that_waits_for_a_slot(
        self, main_module, mam, no_pending, monkeypatch
    ):
        """Only short of unsatisfied slots: queued anyway, to wait for one."""
        monkeypatch.setattr(mam_account, "pending_unsat_count", lambda *_: 0)
        mam.user = _unsat_user(96, 100)
        with patch.object(main_module.backend, "queue_release", return_value=(True, None)) as qr:
            resp = _client(main_module, is_admin=True).post(
                "/api/releases/download", json={**_mam_release(1), "content_type": "audiobook"}
            )
        assert resp.status_code == 200
        assert resp.get_json()["waiting_for_slot"] is True
        qr.assert_called_once()


class TestRecentSnatchesAlreadyCounted:
    """Recent snatches MAM's count already shows aren't counted twice."""

    def _snatch(self, monkeypatch, count: int, *, at: float):
        from shelfmark.core.queue import book_queue

        tasks = [(at, SimpleTask(f"t{i}", i + 1)) for i in range(count)]
        monkeypatch.setattr(book_queue, "handoff_times_since", lambda _since: tasks)

    def test_counts_only_the_snatches_mam_does_not_show_yet(self, mam, monkeypatch):
        monkeypatch.setattr(mam_account, "unsat_reserve_slots", lambda: 5)
        mam.user = _unsat_user(119, 150)
        before = mam_account.get_stats(refresh=True)  # Read before the snatches
        self._snatch(monkeypatch, 13, at=before.fetched_at)

        # MAM's count hasn't moved yet: all 13 take slots. 150 - 5 - 119 - 13.
        assert mam_account.unsat_free_slots(refresh=True) == 13
        # It shows 7 of them now: the other 6 still take slots.
        mam.user = _unsat_user(126, 150)
        assert mam_account.unsat_free_slots(refresh=True) == 150 - 5 - 126 - 6
        # It shows all 13 (132 of 150): 13 slots free, not 0.
        mam.user = _unsat_user(132, 150)
        stats = mam_account.get_stats(refresh=True)
        assert mam_account.unsat_free_slots() == 13
        assert mam_account.pending_unsat_count(stats.fetched_at, stats.unsat_count) == 0

    def test_without_an_earlier_reading_every_snatch_counts(self, mam, monkeypatch):
        monkeypatch.setattr(mam_account, "unsat_reserve_slots", lambda: 5)
        self._snatch(monkeypatch, 13, at=time.time() - 60)
        mam.user = _unsat_user(132, 150)
        assert mam_account.unsat_free_slots(refresh=True) == 0


class TestRatioRoom:
    def test_room_to_ratio(self):
        assert mam_account.ratio_room_bytes(100 * GIB, 30 * GIB, 2.0) == 20 * GIB
        assert mam_account.ratio_room_bytes(100 * GIB, 30 * GIB, 1.0) == 70 * GIB

    def test_negative_once_below(self):
        assert mam_account.ratio_room_bytes(100 * GIB, 60 * GIB, 2.0) == -10 * GIB

    def test_keep_ratio_falls_back_to_the_buffer_when_off(self):
        with patch("shelfmark.core.saved_autoget.target_ratio", return_value=0.0):
            assert mam_account.keep_ratio() == 1.0
        with patch("shelfmark.core.saved_autoget.target_ratio", return_value=2.5):
            assert mam_account.keep_ratio() == 2.5
