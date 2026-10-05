"""A stalled torrent waits in the torrent client instead of being cancelled, and a
download in the client is found by its hash, without downloading the .torrent again.
"""

from __future__ import annotations

from threading import Event

import pytest

from shelfmark.core.models import DownloadTask, QueueStatus
from shelfmark.core.queue import BookQueue
from shelfmark.download import orchestrator
from shelfmark.download.clients import DownloadState, DownloadStatus, base_handler
from shelfmark.release_sources.prowlarr import mam_account

HASH = "a" * 40


@pytest.fixture
def queue(monkeypatch):
    fresh = BookQueue()
    monkeypatch.setattr(orchestrator, "book_queue", fresh)
    monkeypatch.setattr(orchestrator, "ws_manager", None)
    monkeypatch.setattr(orchestrator, "_held_for_slot", {})
    monkeypatch.setattr(orchestrator, "_parking", set())
    monkeypatch.setattr(orchestrator, "_waiting_in_client", {})
    monkeypatch.setattr(orchestrator, "_ensure_client_watcher", lambda: None)
    monkeypatch.setattr(orchestrator, "_client_name", lambda: "Deluge")
    monkeypatch.setattr(mam_account, "grab_allowance", lambda **_kw: mam_account.GrabAllowance(9))
    return fresh


def _add(queue: BookQueue, task_id: str, **fields) -> Event:
    queue.add(DownloadTask(task_id=task_id, source="prowlarr", title=task_id, **fields))
    picked = queue.get_next()
    assert picked is not None
    return picked[1]


class FakeClient:
    name = "deluge"

    def __init__(self, status: DownloadStatus | None = None, present: set[str] | None = None):
        self.status = status
        self.present = present or set()
        self.looked_up: list[str] = []

    def get_status(self, _download_id: str) -> DownloadStatus:
        assert self.status is not None
        return self.status

    def find_existing(self, url, category=None):
        self.looked_up.append(url)
        return (HASH, self.status) if url in self.present else None


def _stall_in_client(queue, *, progress: float = 0.0, client_hash: str | None = HASH):
    """A download handed to the client, stalled there: what the stall check sees."""

    def download(task_id, flag):
        task = queue.get_task(task_id)
        task.torrent_client_hash = client_hash
        task.progress = progress
        queue.update_status(task_id, QueueStatus.DOWNLOADING)
        if not orchestrator._park_stalled_torrent(task_id, flag):
            orchestrator._cancel_stalled_task(task_id)
        return None

    return download


def _status(progress: float, *, complete: bool = False) -> DownloadStatus:
    state = DownloadState.COMPLETE if complete else DownloadState.DOWNLOADING
    return DownloadStatus(progress, state, None, complete, None)


def test_a_stalled_torrent_waits_in_the_client_instead_of_being_cancelled(queue, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", _stall_in_client(queue, progress=12.0))
    orchestrator._process_single_download("t1", _add(queue, "t1"))

    assert queue.get_task_status("t1") == QueueStatus.QUEUED
    assert queue.get_task("t1").status_message.startswith("Waiting in Deluge")
    assert orchestrator.waiting_in_client() == ["t1"]
    assert orchestrator._waiting_in_client["t1"] == 12.0
    assert queue.get_next() is None  # Not back with the workers until it moves


def test_a_stall_outside_a_torrent_client_still_cancels(queue, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", _stall_in_client(queue, client_hash=None))
    orchestrator._process_single_download("t1", _add(queue, "t1"))

    assert queue.get_task_status("t1") == QueueStatus.CANCELLED
    assert orchestrator.waiting_in_client() == []


def test_goes_back_to_the_workers_once_it_moves(queue, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", _stall_in_client(queue, progress=12.0))
    orchestrator._process_single_download("t1", _add(queue, "t1"))
    client = FakeClient(_status(12.0))
    monkeypatch.setattr("shelfmark.download.clients.get_client", lambda _p: client)

    assert orchestrator.release_moving_torrents() == []
    client.status = _status(30.0)
    assert orchestrator.release_moving_torrents() == ["t1"]
    assert orchestrator.waiting_in_client() == []
    picked = queue.get_next()
    assert picked is not None
    assert picked[0] == "t1"


def test_a_finished_torrent_goes_back_too(queue, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", _stall_in_client(queue))
    orchestrator._process_single_download("t1", _add(queue, "t1"))
    client = FakeClient(_status(0.0, complete=True))
    monkeypatch.setattr("shelfmark.download.clients.get_client", lambda _p: client)
    assert orchestrator.release_moving_torrents() == ["t1"]


def test_a_torrent_removed_from_the_client_fails(queue, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", _stall_in_client(queue))
    orchestrator._process_single_download("t1", _add(queue, "t1"))
    client = FakeClient(DownloadStatus.error("Torrent not found"))
    monkeypatch.setattr("shelfmark.download.clients.get_client", lambda _p: client)

    assert orchestrator.release_moving_torrents() == []
    assert queue.get_task_status("t1") == QueueStatus.ERROR
    assert queue.get_task("t1").status_message == "The torrent is no longer in Deluge"


def test_a_cancelled_wait_is_dropped(queue, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", _stall_in_client(queue))
    orchestrator._process_single_download("t1", _add(queue, "t1"))
    queue.cancel_download("t1")
    monkeypatch.setattr("shelfmark.download.clients.get_client", lambda _p: FakeClient())

    assert orchestrator.release_moving_torrents() == []
    assert orchestrator.waiting_in_client() == []
    assert queue.get_task_status("t1") == QueueStatus.CANCELLED


class TestFoundByHash:
    URL = "https://prowlarr/download?id=1"

    def test_a_retry_in_a_freeze_finds_its_torrent_by_hash(self, queue, monkeypatch):
        """MAM refuses the .torrent during its freeze: the hash finds it without one."""
        client = FakeClient(_status(100.0, complete=True), present={f"magnet:?xt=urn:btih:{HASH}"})
        monkeypatch.setattr("shelfmark.download.clients.get_client", lambda _p: client)
        _add(queue, "t1", retry_download_url=self.URL, retry_expected_hash=HASH)

        assert orchestrator._torrent_in_client("t1") is True
        assert client.looked_up == [f"magnet:?xt=urn:btih:{HASH}"]

    def test_falls_back_to_the_url(self):
        client = FakeClient(present={self.URL})
        found = base_handler.find_existing_download(
            client, self.URL, protocol="torrent", info_hash=HASH
        )
        assert found is not None
        assert client.looked_up == [f"magnet:?xt=urn:btih:{HASH}", self.URL]

    def test_usenet_is_found_by_url_only(self):
        client = FakeClient()
        base_handler.find_existing_download(client, self.URL, protocol="usenet", info_hash=HASH)
        assert client.looked_up == [self.URL]

    def test_the_hash_is_kept_once_the_client_has_the_torrent(self):
        task = DownloadTask(task_id="t", source="prowlarr", title="t")
        base_handler._remember_client_hash(task, FakeClient(), "torrent", HASH.upper())
        assert task.torrent_client_hash == HASH.upper()
        assert task.retry_expected_hash == HASH

    @pytest.mark.parametrize(
        ("name", "protocol", "download_id"),
        [
            ("torbox", "torrent", HASH),  # A debrid service doesn't keep it by hash
            ("deluge", "usenet", HASH),
            ("deluge", "torrent", "not-a-hash"),
        ],
    )
    def test_not_kept_otherwise(self, name, protocol, download_id):
        client = FakeClient()
        client.name = name
        task = DownloadTask(task_id="t", source="prowlarr", title="t", retry_expected_hash="b")
        base_handler._remember_client_hash(task, client, protocol, download_id)
        assert task.torrent_client_hash is None
        assert task.retry_expected_hash == "b"
