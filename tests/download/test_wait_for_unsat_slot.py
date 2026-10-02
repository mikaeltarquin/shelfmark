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


def _add(queue: BookQueue, task_id: str, *, mam: bool = True) -> Event:
    queue.add(
        DownloadTask(
            task_id=task_id, source="prowlarr", title=task_id, mam_torrent_id=7 if mam else None
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
