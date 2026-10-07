"""When the next unsatisfied MAM torrent frees a slot, read from the torrent client."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from shelfmark.download.clients import TrackerTorrent
from shelfmark.release_sources.prowlarr import mam_account

HOUR = 3600


def _torrent(seeded_hours: float, *, complete: bool = True) -> TrackerTorrent:
    return TrackerTorrent(name="x", seeding_seconds=int(seeded_hours * HOUR), complete=complete)


def test_next_slot_and_slots_in_the_next_six_hours():
    timing = mam_account.summarize_unsat_timing(
        [
            _torrent(70),  # 2 h left
            _torrent(67),  # 5 h left
            _torrent(60),  # 12 h left
            _torrent(100),  # already satisfied
            _torrent(0, complete=False),  # still downloading: clock not started
        ],
        "Deluge",
    )
    assert timing == {
        "available": True,
        "client": "Deluge",
        "next_seconds": 2 * HOUR,
        "free_seconds": [2 * HOUR, 5 * HOUR, 12 * HOUR],
        "within_window": 2,
        "window_hours": 6,
        "seeding": 3,
        "downloading": 1,
    }


def test_nothing_waiting():
    timing = mam_account.summarize_unsat_timing([_torrent(80)], "Deluge")
    assert timing["next_seconds"] is None
    assert timing["within_window"] == 0


_READ_CLIENT = mam_account._read_client  # The real one; tests read no client by default


def _use_client(monkeypatch, client):
    monkeypatch.setattr(mam_account, "is_configured", lambda: True)
    monkeypatch.setattr(mam_account, "_read_client", _READ_CLIENT)
    monkeypatch.setattr("shelfmark.download.clients.get_client", lambda protocol: client)


def test_reads_the_configured_client(monkeypatch):
    client = SimpleNamespace(
        name="deluge", list_tracker_torrents=MagicMock(return_value=[_torrent(71)])
    )
    _use_client(monkeypatch, client)
    timing = mam_account.unsat_timing()
    client.list_tracker_torrents.assert_called_once_with("myanonamouse")
    assert timing["client"] == "Deluge"
    assert timing["next_seconds"] == HOUR


def test_cached_timing_counts_down(monkeypatch):
    client = SimpleNamespace(
        name="deluge", list_tracker_torrents=MagicMock(return_value=[_torrent(71)])
    )
    _use_client(monkeypatch, client)
    clock = [1_000_000.0]
    monkeypatch.setattr(mam_account.time, "time", lambda: clock[0])
    assert mam_account.unsat_timing()["next_seconds"] == HOUR
    clock[0] += 45
    timing = mam_account.unsat_timing()
    assert timing["next_seconds"] == HOUR - 45
    assert timing["free_seconds"] == [HOUR - 45]
    client.list_tracker_torrents.assert_called_once()


def test_a_client_without_seeding_time(monkeypatch):
    _use_client(monkeypatch, SimpleNamespace(name="rtorrent", list_tracker_torrents=lambda t: None))
    timing = mam_account.unsat_timing()
    assert timing["available"] is False
    assert "seeding time" in timing["reason"]


def test_a_client_that_fails(monkeypatch):
    def boom(tracker):
        raise RuntimeError("connection refused")

    _use_client(monkeypatch, SimpleNamespace(name="deluge", list_tracker_torrents=boom))
    timing = mam_account.unsat_timing()
    assert timing["available"] is False
    assert "connection refused" in timing["reason"]


def test_no_torrent_client(monkeypatch):
    _use_client(monkeypatch, None)
    assert mam_account.unsat_timing()["available"] is False


def test_deluge_lists_mam_torrents(monkeypatch):
    from shelfmark.download.clients.deluge import DelugeClient

    client = DelugeClient.__new__(DelugeClient)
    monkeypatch.setattr(client, "_ensure_connected", lambda: None)
    rpc = MagicMock(
        return_value={
            "a": {
                "name": "A",
                "tracker_host": "myanonamouse.net",
                "seeding_time": 3600,
                "is_finished": True,
            },
            "b": {
                "name": "B",
                "tracker_host": "other.org",
                "seeding_time": 10,
                "is_finished": True,
            },
            "c": {
                "name": "C",
                "tracker_host": "MyAnonamouse.net",
                "seeding_time": 0,
                "is_finished": False,
            },
        }
    )
    monkeypatch.setattr(client, "_rpc_call", rpc)
    assert client.list_tracker_torrents("myanonamouse") == [
        TrackerTorrent("A", 3600, True),
        TrackerTorrent("C", 0, False),
    ]
    assert rpc.call_args.args[0] == "core.get_torrents_status"


def test_qbittorrent_lists_mam_torrents(monkeypatch):
    from shelfmark.download.clients.qbittorrent import QBittorrentClient

    client = QBittorrentClient.__new__(QBittorrentClient)
    records = [
        SimpleNamespace(
            name="A",
            tracker="https://t.myanonamouse.net/tracker.php/x/announce",
            seeding_time=7200,
            progress=1.0,
        ),
        SimpleNamespace(
            name="B", tracker="https://tracker.other.org/announce", seeding_time=5, progress=1.0
        ),
        SimpleNamespace(
            name="C", tracker="https://t.myanonamouse.net/announce", seeding_time=0, progress=0.4
        ),
    ]
    monkeypatch.setattr(client, "_request_torrent_info_records", lambda params: (records, None))
    assert client.list_tracker_torrents("myanonamouse") == [
        TrackerTorrent("A", 7200, True),
        TrackerTorrent("C", 0, False),
    ]


def test_transmission_lists_mam_torrents():
    from shelfmark.download.clients.transmission import TransmissionClient

    client = TransmissionClient.__new__(TransmissionClient)
    tracker = lambda url: SimpleNamespace(announce=url)
    client._client = SimpleNamespace(
        get_torrents=lambda arguments: [
            SimpleNamespace(
                name="A",
                seconds_seeding=60,
                percent_done=1.0,
                trackers=[tracker("https://t.myanonamouse.net/a")],
            ),
            SimpleNamespace(
                name="B",
                seconds_seeding=60,
                percent_done=1.0,
                trackers=[tracker("https://other.org/a")],
            ),
        ]
    )
    assert client.list_tracker_torrents("myanonamouse") == [TrackerTorrent("A", 60, True)]
