"""A torrent the client is downloading goes on there without holding a worker, and a
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
    monkeypatch.setattr(orchestrator, "_watching", set())
    monkeypatch.setattr(orchestrator, "_watched", {})
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


def _in_client(queue, *, progress: float = 0.0, client_hash: str | None = HASH):
    """A download handed to the client, then handed over to the watcher (after
    `WATCH_AFTER_SECONDS`, or a stall), or cancelled when it can't be."""

    def download(task_id, flag):
        task = queue.get_task(task_id)
        task.torrent_client_hash = client_hash
        task.progress = progress
        queue.update_status(task_id, QueueStatus.DOWNLOADING)
        if not orchestrator._watch_in_background(task_id, flag):
            orchestrator._cancel_stalled_task(task_id)
        return None

    return download


def _status(progress: float, *, complete: bool = False) -> DownloadStatus:
    state = DownloadState.COMPLETE if complete else DownloadState.DOWNLOADING
    return DownloadStatus(progress, state, None, complete, None)


def _use(monkeypatch, client) -> None:
    monkeypatch.setattr("shelfmark.download.clients.get_client", lambda _p: client)


def test_a_torrent_in_the_client_frees_its_worker_and_stays_downloading(queue, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", _in_client(queue, progress=12.0))
    orchestrator._process_single_download("t1", _add(queue, "t1"))

    assert queue.get_task_status("t1") == QueueStatus.DOWNLOADING
    assert queue.get_task("t1").status_message == "Downloading in Deluge (12%)"
    assert orchestrator.watched_downloads() == ["t1"]
    assert queue.get_next() is None  # Not back with the workers until it's finished


def test_its_retry_data_is_saved_with_the_hash(queue, monkeypatch):
    saved: list[str | None] = []
    queue.set_queue_hook(lambda _id, task: saved.append(task.torrent_client_hash))
    monkeypatch.setattr(orchestrator, "_download_task", _in_client(queue))
    orchestrator._process_single_download("t1", _add(queue, "t1"))
    assert saved[-1] == HASH


def test_a_download_outside_a_torrent_client_still_cancels_on_a_stall(queue, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", _in_client(queue, client_hash=None))
    orchestrator._process_single_download("t1", _add(queue, "t1"))

    assert queue.get_task_status("t1") == QueueStatus.CANCELLED
    assert orchestrator.watched_downloads() == []


def test_progress_is_shown_and_a_finished_torrent_goes_back_to_import(queue, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", _in_client(queue, progress=12.0))
    orchestrator._process_single_download("t1", _add(queue, "t1"))
    client = FakeClient(_status(40.0))
    _use(monkeypatch, client)

    assert orchestrator.check_watched_downloads() == []
    assert queue.get_task("t1").progress == 40.0
    assert queue.get_task("t1").status_message == "Downloading in Deluge (40%)"

    client.status = _status(100.0, complete=True)
    assert orchestrator.check_watched_downloads() == ["t1"]
    assert orchestrator.watched_downloads() == []
    picked = queue.get_next()
    assert picked is not None
    assert picked[0] == "t1"


def test_a_torrent_with_no_progress_says_so(queue, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", _in_client(queue, progress=5.0))
    orchestrator._process_single_download("t1", _add(queue, "t1"))
    _use(monkeypatch, FakeClient(_status(5.0)))
    later = orchestrator.time.time() + orchestrator.STALL_TIMEOUT + 60
    monkeypatch.setattr(orchestrator.time, "time", lambda: later)

    orchestrator.check_watched_downloads()
    message = queue.get_task("t1").status_message
    assert message.startswith("No progress in Deluge for 6 minutes at 5%")
    assert queue.get_task_status("t1") == QueueStatus.DOWNLOADING


def test_a_torrent_removed_from_the_client_fails(queue, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", _in_client(queue))
    orchestrator._process_single_download("t1", _add(queue, "t1"))
    _use(monkeypatch, FakeClient(DownloadStatus.error("Torrent not found")))

    assert orchestrator.check_watched_downloads() == []
    assert queue.get_task_status("t1") == QueueStatus.ERROR
    assert queue.get_task("t1").status_message == "The torrent is no longer in Deluge"


def test_a_cancelled_one_is_dropped(queue, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", _in_client(queue))
    orchestrator._process_single_download("t1", _add(queue, "t1"))
    assert queue.cancel_download("t1") is True
    _use(monkeypatch, FakeClient())

    assert orchestrator.check_watched_downloads() == []
    assert orchestrator.watched_downloads() == []
    assert queue.get_task_status("t1") == QueueStatus.CANCELLED


def test_due_for_watching_after_a_while_in_the_client(queue):
    _add(queue, "t1")
    task = queue.get_task("t1")
    task.torrent_client_hash = HASH
    queue.update_status("t1", QueueStatus.DOWNLOADING)
    since: dict[str, float] = {}

    assert orchestrator._due_for_watching(["t1"], since, 1000.0) == []
    assert orchestrator._due_for_watching(["t1"], since, 1010.0) == []
    later = 1000.0 + orchestrator.WATCH_AFTER_SECONDS
    assert orchestrator._due_for_watching(["t1"], since, later) == ["t1"]


def test_not_due_before_the_client_has_it(queue):
    _add(queue, "t1")
    queue.update_status("t1", QueueStatus.DOWNLOADING)  # No hash: not in a client
    assert orchestrator._due_for_watching(["t1"], {"t1": 0.0}, 10_000.0) == []


class TestOneSnatch:
    """Coming back to import doesn't count as a new MAM snatch."""

    def test_the_handoff_is_recorded_once(self, queue):
        _add(queue, "t1", mam_torrent_id=7)
        queue.get_task("t1").torrent_client_hash = HASH
        queue.update_status("t1", QueueStatus.DOWNLOADING)
        first = queue.handoff_times_since(0)
        assert [task.task_id for _at, task in first] == ["t1"]

        assert queue.enqueue_existing("t1")
        queue.get_next()
        queue.update_status("t1", QueueStatus.RESOLVING)
        queue.update_status("t1", QueueStatus.DOWNLOADING)
        assert queue.handoff_times_since(0) == first

    def test_a_refused_grab_counts_on_the_next_try(self, queue):
        _add(queue, "t1", mam_torrent_id=7)
        queue.update_status("t1", QueueStatus.DOWNLOADING)
        queue.forget_handoff("t1")
        assert queue.get_task("t1").handoff_recorded is False


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
