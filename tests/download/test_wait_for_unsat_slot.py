"""MAM downloads at the unsatisfied limit wait in the queue instead of failing."""

from __future__ import annotations

from threading import Event

import pytest

from shelfmark.core.models import DownloadTask, QueueStatus
from shelfmark.core.queue import BookQueue
from shelfmark.download import orchestrator
from shelfmark.release_sources.prowlarr import mam_account


@pytest.fixture
def queue(monkeypatch):
    fresh = BookQueue()
    monkeypatch.setattr(orchestrator, "book_queue", fresh)
    monkeypatch.setattr(orchestrator, "ws_manager", None)
    monkeypatch.setattr(orchestrator, "_held_for_slot", {})
    monkeypatch.setattr(orchestrator, "_ensure_slot_watcher", lambda: None)
    return fresh


@pytest.fixture
def slots(monkeypatch):
    """Free unsatisfied slots MAM reports; None means unknown."""
    state = {"free": 0, "enabled": True}
    monkeypatch.setattr(mam_account, "unsat_free_slots", lambda **_kw: state["free"])
    monkeypatch.setattr(mam_account, "unsat_check_enabled", lambda: state["enabled"])
    return state


def _add(queue: BookQueue, task_id: str, *, mam: bool = True, **fields) -> Event:
    queue.add(
        DownloadTask(
            task_id=task_id,
            source="prowlarr",
            title=task_id,
            mam_torrent_id=7 if mam else None,
            **fields,
        )
    )
    picked = queue.get_next()
    assert picked is not None
    return picked[1]


def test_waits_instead_of_grabbing_when_no_slot_is_free(queue, slots, monkeypatch):
    grabbed: list[str] = []
    monkeypatch.setattr(orchestrator, "_download_task", lambda tid, _f: grabbed.append(tid))
    flag = _add(queue, "t1")

    orchestrator._process_single_download("t1", flag)

    assert grabbed == []
    assert queue.get_task_status("t1") == QueueStatus.QUEUED
    assert queue.get_task("t1").status_message == orchestrator.UNSAT_WAIT_MESSAGE
    assert orchestrator.held_for_slot() == ["t1"]
    assert queue.get_next() is None  # Not back in line until released


def test_a_grab_refused_at_the_limit_waits_instead_of_failing(queue, slots, monkeypatch):
    def refused(task_id, _flag):
        slots["free"] = 0  # The account filled up meanwhile
        return None

    slots["free"] = 1
    monkeypatch.setattr(orchestrator, "_download_task", refused)
    flag = _add(queue, "t1")

    orchestrator._process_single_download("t1", flag)

    assert queue.get_task_status("t1") == QueueStatus.QUEUED
    assert orchestrator.held_for_slot() == ["t1"]


def test_other_failures_still_fail(queue, slots, monkeypatch):
    slots["free"] = 3
    monkeypatch.setattr(orchestrator, "_download_task", lambda _t, _f: None)
    flag = _add(queue, "t1")
    orchestrator._process_single_download("t1", flag)
    assert queue.get_task_status("t1") == QueueStatus.ERROR

    flag = _add(queue, "plain", mam=False)
    slots["free"] = 0  # Not a MAM torrent: the limit has nothing to do with it
    orchestrator._process_single_download("plain", flag)
    assert queue.get_task_status("plain") == QueueStatus.ERROR


def test_releases_the_longest_waiting_as_slots_free(queue, slots, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", lambda _t, _f: None)
    for task_id in ("a", "b", "c"):
        orchestrator._process_single_download(task_id, _add(queue, task_id))
    assert orchestrator.held_for_slot() == ["a", "b", "c"]

    assert orchestrator.release_held_downloads() == []  # Still full
    slots["free"] = 2
    assert orchestrator.release_held_downloads() == ["a", "b"]
    assert orchestrator.held_for_slot() == ["c"]
    released = [queue.get_next(), queue.get_next(), queue.get_next()]
    assert [r[0] if r else None for r in released] == ["a", "b", None]


def test_keeps_waiting_when_mam_cannot_be_read_and_goes_when_the_check_is_off(
    queue, slots, monkeypatch
):
    monkeypatch.setattr(orchestrator, "_download_task", lambda _t, _f: None)
    orchestrator._process_single_download("a", _add(queue, "a"))
    slots["free"] = None
    assert orchestrator.release_held_downloads() == []
    slots["enabled"] = False
    assert orchestrator.release_held_downloads() == ["a"]


def test_a_cancelled_wait_is_dropped(queue, slots, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", lambda _t, _f: None)
    orchestrator._process_single_download("a", _add(queue, "a"))
    queue.cancel_download("a")
    slots["free"] = 5
    assert orchestrator.release_held_downloads() == []
    assert orchestrator.held_for_slot() == []


class _Client:
    """A torrent client holding the torrents for `present` URLs."""

    def __init__(self, present: set[str], error: Exception | None = None):
        self.present = present
        self.error = error
        self.looked_up: list[str] = []

    def find_existing(self, url, category=None):
        self.looked_up.append(url)
        if self.error:
            raise self.error
        return ("hash", object()) if url in self.present else None


def _use_client(monkeypatch, client):
    monkeypatch.setattr("shelfmark.download.clients.get_client", lambda _protocol: client)


def test_a_retry_whose_torrent_is_in_the_client_goes_without_a_slot(queue, slots, monkeypatch):
    grabbed: list[str] = []
    monkeypatch.setattr(orchestrator, "_download_task", lambda tid, _f: grabbed.append(tid) or "/x")
    client = _Client({"https://mam/t/1.torrent"})
    _use_client(monkeypatch, client)
    flag = _add(queue, "t1", retry_download_url="https://mam/t/1.torrent")

    orchestrator._process_single_download("t1", flag)

    assert grabbed == ["t1"]
    assert client.looked_up == ["https://mam/t/1.torrent"]
    assert orchestrator.held_for_slot() == []


def test_a_new_torrent_still_waits(queue, slots, monkeypatch):
    grabbed: list[str] = []
    monkeypatch.setattr(orchestrator, "_download_task", lambda tid, _f: grabbed.append(tid))
    _use_client(monkeypatch, _Client(set()))
    flag = _add(queue, "t1", retry_download_url="https://mam/t/2.torrent")

    orchestrator._process_single_download("t1", flag)

    assert grabbed == []
    assert orchestrator.held_for_slot() == ["t1"]


def test_a_client_that_cannot_be_asked_still_waits(queue, slots, monkeypatch):
    monkeypatch.setattr(orchestrator, "_download_task", lambda _t, _f: None)
    _use_client(monkeypatch, _Client(set(), error=RuntimeError("connection refused")))
    flag = _add(queue, "t1", retry_download_url="https://mam/t/1.torrent")

    orchestrator._process_single_download("t1", flag)

    assert orchestrator.held_for_slot() == ["t1"]


def test_a_failed_import_of_a_finished_torrent_fails_instead_of_waiting(
    queue, slots, monkeypatch, tmp_path
):
    def finished_then_failed(task_id, _flag):
        queue.get_task(task_id).original_download_path = str(tmp_path)
        slots["free"] = 0  # Full by the time the import fails
        return None

    slots["free"] = 1
    monkeypatch.setattr(orchestrator, "_download_task", finished_then_failed)
    flag = _add(queue, "t1")

    orchestrator._process_single_download("t1", flag)

    assert queue.get_task_status("t1") == QueueStatus.ERROR
    assert orchestrator.held_for_slot() == []
