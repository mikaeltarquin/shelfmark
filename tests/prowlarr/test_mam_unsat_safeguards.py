"""Safeguards against grabbing past MAM's unsatisfied limit when its count can't be
trusted: the torrent client's own count, rejected announces, and MAM's download freeze.
"""

from __future__ import annotations

import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from shelfmark.download.clients import TrackerTorrent
from shelfmark.release_sources.prowlarr import mam_account, mam_freeze
from tests.prowlarr.test_mam_account import USER, FakeMam

HOUR = 3600
REJECTED = "Unrecognized host/PassKey. (149.22.95.74) See https://s.mrd.ninja/upmm"


def _unsat_user(count: int, limit: int) -> dict:
    return {**USER, "snatch_summary": {"unsat": {"count": count, "limit": limit}}}


def _seeding(hours: float, *, error: str | None = None) -> TrackerTorrent:
    return TrackerTorrent("t", int(hours * HOUR), complete=True, tracker_error=error)


@pytest.fixture
def mam(monkeypatch, tmp_path):
    from shelfmark.core.queue import book_queue
    from shelfmark.release_sources.prowlarr import mam_points

    monkeypatch.setattr(mam_points, "_path", lambda: tmp_path / "points.json")
    monkeypatch.setattr(mam_account, "_unsat_samples", [])
    monkeypatch.setattr(mam_account, "unsat_reserve_slots", lambda: 5)
    monkeypatch.setattr(book_queue, "handoff_times_since", lambda _since: [])
    fake = FakeMam(_unsat_user(130, 150))
    monkeypatch.setattr(mam_account, "MamClient", fake)
    monkeypatch.setattr(mam_account, "session_id", lambda: "session")
    mam_account.invalidate_stats()
    yield fake
    mam_account.invalidate_stats()


@pytest.fixture
def client(monkeypatch):
    """The torrent client's MAM torrents, as `client.torrents`."""
    state = SimpleNamespace(torrents=[])
    monkeypatch.setattr(
        mam_account,
        "_read_client",
        lambda: mam_account._ClientRead(time.time(), "Deluge", list(state.torrents)),
    )
    return state


class TestClientCount:
    def test_the_incident_mam_shows_130_but_the_client_holds_150(self, mam, client):
        """Announces refused for an hour: MAM's count stuck at 130 while 20 more
        torrents sat in Deluge. Their slots are taken all the same."""
        client.torrents = [_seeding(1) for _ in range(150)]
        assert mam_account.unsat_free_slots(refresh=True) == 150 - 5 - 150

    def test_satisfied_torrents_in_the_client_dont_count(self, mam, client):
        client.torrents = [_seeding(80) for _ in range(100)] + [_seeding(10)] * 10
        # The client's 10 are fewer than MAM's 130: MAM's count stands.
        assert mam_account.unsat_free_slots(refresh=True) == 150 - 5 - 130

    def test_downloading_torrents_count(self, mam, client):
        client.torrents = [TrackerTorrent("t", 0, complete=False)] * 140
        assert mam_account.unsat_free_slots(refresh=True) == 5

    def test_snatches_since_the_client_was_read_count(self, mam, client, monkeypatch):
        from shelfmark.core.queue import book_queue

        client.torrents = [_seeding(1)] * 140
        task = SimpleNamespace(task_id="new", mam_torrent_id=9)
        monkeypatch.setattr(book_queue, "handoff_times_since", lambda _s: [(time.time(), task)])
        assert mam_account.client_unsat_count(refresh=True) == 141
        assert mam_account.client_unsat_count(exclude={"new"}) == 140

    def test_without_a_client_mam_count_stands(self, mam):
        assert mam_account.client_unsat_count() is None
        assert mam_account.unsat_free_slots(refresh=True) == 15

    def test_the_header_sees_the_client_count_too(self, mam, client):
        client.torrents = [_seeding(1)] * 150
        snapshot = mam_account.ratio_snapshot()
        assert snapshot["unsat_count"] + snapshot["unsat_pending"] == 150


class TestAnnounces:
    def test_rejected_announces_are_reported(self, client):
        client.torrents = [_seeding(1), _seeding(2, error=REJECTED)]
        problem = mam_account.announce_problem()
        assert problem is not None
        assert "Deluge" in problem
        assert "1 torrent:" in problem
        assert "Unrecognized host/PassKey" in problem

    @pytest.mark.parametrize("error", ["timed out", "Torrent not registered with this tracker"])
    def test_other_tracker_errors_are_not(self, client, error):
        client.torrents = [_seeding(1, error=error)]
        assert mam_account.announce_problem() is None


class TestGrabAllowance:
    def test_free_slots_when_all_is_well(self, mam, client):
        client.torrents = [_seeding(1)] * 100
        assert mam_account.grab_allowance(refresh=True) == mam_account.GrabAllowance(15)

    def test_holds_while_announces_are_rejected(self, mam, client):
        client.torrents = [_seeding(1, error=REJECTED)]
        allowance = mam_account.grab_allowance(refresh=True)
        assert allowance.free == 0
        assert allowance.hold is not None
        assert "rejecting" in allowance.hold

    def test_holds_while_mam_cannot_be_read(self, mam):
        mam.user = mam_account.MamError("Invalid session - ASN mismatch")
        allowance = mam_account.grab_allowance(refresh=True)
        assert allowance.free == 0
        assert allowance.hold is not None
        assert "ASN mismatch" in allowance.hold

    def test_holds_through_a_freeze(self, mam):
        mam_freeze.set_freeze(26 * HOUR, source="detected")
        allowance = mam_account.grab_allowance(refresh=True)
        assert allowance.free == 0
        assert allowance.hold is not None
        assert "paused downloads" in allowance.hold
        assert "25 h 59 m" in allowance.hold or "26 h 00 m" in allowance.hold

    def test_nothing_held_when_the_check_is_off(self, mam, monkeypatch):
        mam_freeze.set_freeze(HOUR, source="manual")
        monkeypatch.setattr(mam_account, "unsat_check_enabled", lambda: False)
        assert mam_account.grab_allowance() == mam_account.GrabAllowance(None)


class TestFreeze:
    MESSAGE = (
        "Attempted to Download Past Unsatisfied limit. Happened: 2026-10-05 15:53:57 "
        "Time Till Download Allowed: 1d 02:04:02"
    )

    def test_parsed_from_mams_message(self):
        assert mam_freeze.parse_refusal(self.MESSAGE) == 26 * HOUR + 4 * 60 + 2

    def test_parsed_from_html_and_escaped_html(self):
        html = "<tr><td>Time Till Download Allowed:</td><td>23:00:00</td></tr>"
        assert mam_freeze.parse_refusal(html) == 23 * HOUR
        escaped = r'{"error":"<td>Time Till Download Allowed:</td> 1d 00:00:05"}'
        assert mam_freeze.parse_refusal(escaped) == 24 * HOUR + 5

    def test_a_day_when_no_time_is_given(self):
        text = "Attempted to Download Past Unsatisfied limit"
        assert mam_freeze.parse_refusal(text) == mam_freeze.DEFAULT_FREEZE_SECONDS

    def test_other_replies_are_not_a_freeze(self):
        assert mam_freeze.parse_refusal("<html>Not found</html>") is None
        assert mam_freeze.note_refusal("Not found") is False
        assert mam_freeze.current() is None

    def test_recorded_and_lifted(self, monkeypatch):
        assert mam_freeze.note_refusal(self.MESSAGE) is True
        freeze = mam_freeze.current()
        assert freeze is not None
        assert freeze["source"] == "detected"
        remaining = mam_freeze.remaining_seconds()
        assert remaining is not None
        assert 26 * HOUR <= remaining <= 26 * HOUR + 4 * 60 + 2

        later = time.time() + 27 * HOUR
        monkeypatch.setattr(mam_freeze.time, "time", lambda: later)
        assert mam_freeze.current() is None

    def test_cleared_by_hand(self):
        mam_freeze.set_freeze(HOUR, source="manual")
        mam_freeze.clear()
        assert mam_freeze.remaining_seconds() is None

    def test_duration_as_entered(self):
        assert mam_freeze.parse_duration("1d 02:04:02") == 26 * HOUR + 242
        assert mam_freeze.parse_duration(" 5:00:00 ") == 5 * HOUR
        assert mam_freeze.parse_duration("tomorrow") is None

    def test_timing_reports_the_freeze(self, monkeypatch, client):
        monkeypatch.setattr(mam_account, "is_configured", lambda: True)
        mam_freeze.set_freeze(2 * HOUR, source="manual")
        timing = mam_account.unsat_timing()
        assert timing["frozen_source"] == "manual"
        assert 2 * HOUR - 5 <= timing["frozen_seconds"] <= 2 * HOUR


class TestRefusedDownload:
    def _fetch(self, monkeypatch, status: int, body: bytes):
        from shelfmark.download.clients import torrent_utils

        response = MagicMock(status_code=status, content=body, headers={})
        response.raise_for_status.side_effect = (
            None if status < 400 else torrent_utils.requests.exceptions.HTTPError("refused")
        )
        monkeypatch.setattr(torrent_utils.requests, "get", lambda *_a, **_kw: response)
        return torrent_utils._fetch_torrent_info("https://prowlarr/download?id=1")

    def test_a_refusal_page_records_the_freeze(self, monkeypatch):
        info = self._fetch(monkeypatch, 200, TestFreeze.MESSAGE.encode())
        assert info.info_hash is None
        assert mam_freeze.current() is not None

    def test_an_error_reply_records_the_freeze(self, monkeypatch):
        info = self._fetch(monkeypatch, 500, TestFreeze.MESSAGE.encode())
        assert info.fetch_error
        assert mam_freeze.current() is not None

    def test_other_bad_replies_dont(self, monkeypatch):
        self._fetch(monkeypatch, 404, b"Not found")
        assert mam_freeze.current() is None


class TestClientsReportRejectedAnnounces:
    def test_deluge(self, monkeypatch):
        from shelfmark.download.clients.deluge import DelugeClient

        deluge = DelugeClient.__new__(DelugeClient)
        monkeypatch.setattr(deluge, "_ensure_connected", lambda: None)
        statuses = {
            "a": {
                "name": "A",
                "tracker_host": "myanonamouse.net",
                "seeding_time": 60,
                "is_finished": True,
                "tracker_status": f"Error: {REJECTED}",
            },
            "b": {
                "name": "B",
                "tracker_host": "myanonamouse.net",
                "seeding_time": 60,
                "is_finished": True,
                "tracker_status": "Announce OK",
            },
        }
        monkeypatch.setattr(deluge, "_rpc_call", MagicMock(return_value=statuses))
        assert [t.tracker_error for t in deluge.list_tracker_torrents("myanonamouse")] == [
            REJECTED,
            None,
        ]

    def test_qbittorrent_finds_mam_torrents_with_no_working_tracker(self, monkeypatch):
        from shelfmark.download.clients import qbittorrent
        from shelfmark.download.clients.qbittorrent import QBittorrentClient

        monkeypatch.setattr(qbittorrent, "_on_tracker", {})

        qbit = QBittorrentClient.__new__(QBittorrentClient)
        qbit._base_url = "http://qbit"
        qbit._api_key = "key"
        records = [
            SimpleNamespace(name="A", hash="a", tracker="", seeding_time=60, progress=1.0),
            SimpleNamespace(name="B", hash="b", tracker="", seeding_time=60, progress=1.0),
        ]
        rows = {
            "a": [
                {"url": "** [DHT] **", "status": 0, "msg": ""},
                {"url": "https://t.myanonamouse.net/announce", "status": 4, "msg": REJECTED},
            ],
            "b": [{"url": "https://other.org/announce", "status": 4, "msg": "down"}],
        }

        def get(_url, params, timeout):
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: rows[params["hash"]])

        monkeypatch.setattr(qbit, "_request_torrent_info_records", lambda _p: (records, None))
        qbit._client = SimpleNamespace(_session=SimpleNamespace(get=get))
        assert qbit.list_tracker_torrents("myanonamouse") == [
            TrackerTorrent("A", 60, True, REJECTED)
        ]

    def test_transmission(self):
        from shelfmark.download.clients.transmission import TransmissionClient

        transmission = TransmissionClient.__new__(TransmissionClient)
        url = "https://t.myanonamouse.net/a"
        stats = SimpleNamespace(
            announce=url,
            has_announced=True,
            last_announce_succeeded=False,
            last_announce_result=REJECTED,
        )
        transmission._client = SimpleNamespace(
            get_torrents=lambda arguments: [
                SimpleNamespace(
                    name="A",
                    seconds_seeding=60,
                    percent_done=1.0,
                    trackers=[SimpleNamespace(announce=url)],
                    tracker_stats=[stats],
                )
            ]
        )
        assert transmission.list_tracker_torrents("myanonamouse") == [
            TrackerTorrent("A", 60, True, REJECTED)
        ]

    def test_qbittorrent_asks_once_about_other_and_idle_torrents(self, monkeypatch):
        from shelfmark.download.clients import qbittorrent
        from shelfmark.download.clients.qbittorrent import QBittorrentClient

        monkeypatch.setattr(qbittorrent, "_on_tracker", {})
        qbit = QBittorrentClient.__new__(QBittorrentClient)
        qbit._base_url = "http://qbit"
        qbit._api_key = "key"
        records = [
            SimpleNamespace(name="O", hash="o", tracker="", state="stalledUP", progress=1.0),
            SimpleNamespace(name="P", hash="p", tracker="", state="stoppedUP", progress=1.0),
        ]
        rows = {
            "o": [{"url": "https://other.org/announce", "status": 4, "msg": "down"}],
            "p": [{"url": "https://t.myanonamouse.net/announce", "status": 0, "msg": ""}],
        }
        asked: list[str] = []

        def get(_url, params, timeout):
            asked.append(params["hash"])
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: rows[params["hash"]])

        monkeypatch.setattr(qbit, "_request_torrent_info_records", lambda _p: (records, None))
        qbit._client = SimpleNamespace(_session=SimpleNamespace(get=get))
        for _ in range(3):
            assert [t.name for t in qbit.list_tracker_torrents("myanonamouse")] == ["P"]
        assert sorted(asked) == ["o", "p"]
