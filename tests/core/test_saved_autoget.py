"""Getting saved items automatically once there is room on MyAnonamouse."""

from __future__ import annotations

from typing import Any

import pytest

from shelfmark.core import saved_autoget
from shelfmark.core.saved_autoget import AutoGetHooks, Owner, SavedAutoGetter
from shelfmark.core.saved_items import SavedItemsService
from shelfmark.release_sources.prowlarr import mam_account
from shelfmark.release_sources.prowlarr.mam import MamError

GIB = 1024**3
BOOK = {"id": "b1", "provider": "hardcover", "provider_id": "42", "title": "Book Title"}
OWNER = Owner(user_id=1, username="reader")


def _payload(source_id: str, *, torrent_id: int | None = 101, size: int = GIB) -> dict[str, Any]:
    extra: dict[str, Any] = {"freeleech": False}
    if torrent_id is not None:
        extra["mam_torrent_id"] = torrent_id
    return {"source": "prowlarr", "source_id": source_id, "size_bytes": size, "extra": extra}


def _stats(*, uploaded: int = 300 * GIB, downloaded: int = 100 * GIB, classname: str = "User"):
    return mam_account.MamStats(
        username="reader",
        classname=classname,
        uploaded_bytes=uploaded,
        downloaded_bytes=downloaded,
        ratio=uploaded / downloaded,
        seedbonus=0.0,
        vip_until=None,
        unsat_count=10,
        unsat_limit=100,
    )


class FakeMam:
    """Stands in for the MAM account: stats, freeleech lookups and the buffer check."""

    def __init__(self) -> None:
        self.stats = _stats()
        self.freeleech: dict[int, bool] = {}
        self.unsat_free = 10
        self.lookup_error = False
        self.buffer_checks: list[list[dict[str, Any]]] = []

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(mam_account, "is_configured", lambda: True)
        monkeypatch.setattr(mam_account, "get_stats", lambda **_: self.stats)
        monkeypatch.setattr(mam_account, "pending_charge_bytes", lambda: 0)
        monkeypatch.setattr(mam_account, "torrent_is_freeleech", self._freeleech)
        monkeypatch.setattr(mam_account, "check_buffer", self._check)

    def _freeleech(self, torrent_id: int, *, vip: bool) -> bool:
        if self.lookup_error:
            msg = "MAM is down"
            raise MamError(msg)
        return self.freeleech.get(torrent_id, False)

    def _check(self, releases: list[dict[str, Any]]) -> mam_account.BufferCheck:
        self.buffer_checks.append(releases)
        count = len(releases)
        ok = count <= self.unsat_free
        return mam_account.BufferCheck(
            ok=ok,
            checked=True,
            request_bytes=0,
            unsat_ok=ok,
            request_count=count,
            unsat_count=100 - 5 - self.unsat_free,
            unsat_limit=100,
            unsat_reserve=5,
        )


@pytest.fixture
def mam(monkeypatch):
    fake = FakeMam()
    fake.install(monkeypatch)
    monkeypatch.setattr(saved_autoget, "enabled", lambda: True)
    return fake


@pytest.fixture
def service(tmp_path):
    svc = SavedItemsService(str(tmp_path / "users.db"))
    svc.initialize()
    return svc


class Recorder:
    def __init__(self) -> None:
        self.queued: list[dict[str, Any]] = []
        self.notified: list[str] = []
        self.allowed = True
        self.fail_ids: set[str] = set()

    def hooks(self) -> AutoGetHooks:
        return AutoGetHooks(
            resolve_owner=lambda owner: OWNER if owner == "user:1" else None,
            may_download=lambda _owner, _payload: self.allowed,
            queue_release=self._queue,
            notify=lambda item, _owner: self.notified.append(item["title"]),
        )

    def _queue(self, payload: dict[str, Any], _owner: Owner) -> tuple[bool, str | None]:
        if payload["source_id"] in self.fail_ids:
            return False, "source unavailable"
        self.queued.append(payload)
        return True, None


def _mark(service, payloads, *, conditions=None, book=BOOK):
    releases = [
        {"content_type": "ebook", "release": {"source": "prowlarr", "source_id": p["source_id"]}}
        for p in payloads
    ]
    content_type = "combined" if len(payloads) > 1 else "ebook"
    item = service.save(
        "user:1", book=book, content_type=content_type, releases=releases, payloads=payloads
    )
    service.update("user:1", item["id"], auto_get=True, conditions=conditions or {})
    return item["id"]


def test_gets_an_item_once_it_fits_then_removes_it(service, mam):
    recorder = Recorder()
    item_id = _mark(service, [_payload("r1")])
    report = SavedAutoGetter(service, recorder.hooks()).run_check()
    assert report.queued == [item_id]
    assert [p["source_id"] for p in recorder.queued] == ["r1"]
    assert recorder.notified == ["Book Title"]
    assert service.list_items("user:1") == []


def test_waits_for_unsatisfied_slots_and_says_how_many(service, mam):
    mam.unsat_free = 1
    recorder = Recorder()
    item_id = _mark(service, [_payload("r1", torrent_id=1), _payload("r2", torrent_id=2)])
    report = SavedAutoGetter(service, recorder.hooks()).run_check()
    assert report.queued == []
    assert report.waiting[item_id] == "Waiting for 1 unsatisfied slot"
    assert recorder.queued == []
    item = service.get_item("user:1", item_id)
    assert item is not None
    assert item["auto_status"] == "Waiting for 1 unsatisfied slot"
    assert item["auto_get"] is True


def test_freeleech_goes_even_below_the_target_ratio(service, mam):
    # Ratio 1.5, under the 2.0 target: a freeleech torrent can't lower it, so it goes.
    mam.stats = _stats(uploaded=150 * GIB, downloaded=100 * GIB)
    mam.freeleech[5] = True
    recorder = Recorder()
    item_id = _mark(service, [_payload("r1", torrent_id=5, size=50 * GIB)])
    assert SavedAutoGetter(service, recorder.hooks()).run_check().queued == [item_id]
    # Queued as freeleech, so the buffer check and the download don't count its size.
    assert recorder.queued[0]["extra"]["freeleech"] is True


def test_a_small_download_goes_even_below_the_target_ratio(service, mam):
    # A 5 MB ebook moves a 1.5 ratio on 100 GB by well under 0.01.
    mam.stats = _stats(uploaded=150 * GIB, downloaded=100 * GIB)
    recorder = Recorder()
    item_id = _mark(service, [_payload("r1", size=5 * 1024**2)])
    assert SavedAutoGetter(service, recorder.hooks()).run_check().queued == [item_id]


def test_a_large_download_waits_for_the_ratio_or_freeleech(service, mam):
    # 300 up / 100 down; a 60 GB download leaves 300 / 160 = 1.88.
    mam.stats = _stats(uploaded=300 * GIB, downloaded=100 * GIB)
    recorder = Recorder()
    getter = SavedAutoGetter(service, recorder.hooks())
    item_id = _mark(service, [_payload("r1", torrent_id=7, size=60 * GIB)])
    assert getter.run_check().waiting[item_id] == (
        "Waiting for freeleech or ratio 2.00: 60.00 GB would take it from 3.00 to 1.88"
    )
    # Freeleech is checked live on every run.
    mam.freeleech[7] = True
    assert getter.run_check().queued == [item_id]


def test_a_large_download_goes_once_the_ratio_allows(service, mam):
    mam.stats = _stats(uploaded=300 * GIB, downloaded=100 * GIB)
    recorder = Recorder()
    getter = SavedAutoGetter(service, recorder.hooks())
    item_id = _mark(service, [_payload("r1", size=60 * GIB)])
    assert item_id in getter.run_check().waiting
    mam.stats = _stats(uploaded=400 * GIB, downloaded=100 * GIB)
    assert getter.run_check().queued == [item_id]


def test_the_target_ratio_is_a_setting(service, mam, monkeypatch):
    mam.stats = _stats(uploaded=300 * GIB, downloaded=100 * GIB)
    recorder = Recorder()
    item_id = _mark(service, [_payload("r1", size=60 * GIB)])
    monkeypatch.setattr(saved_autoget, "target_ratio", lambda: 1.5)
    assert SavedAutoGetter(service, recorder.hooks()).run_check().queued == [item_id]


def test_when_mam_cannot_say_freeleech_the_search_result_stands(service, mam):
    mam.lookup_error = True
    recorder = Recorder()
    item_id = _mark(service, [_payload("r1", size=GIB)])
    assert SavedAutoGetter(service, recorder.hooks()).run_check().queued == [item_id]


def test_old_per_item_conditions_are_ignored(service, mam):
    recorder = Recorder()
    item_id = _mark(service, [_payload("r1")], conditions={"freeleech_only": True})
    assert SavedAutoGetter(service, recorder.hooks()).run_check().queued == [item_id]


def test_needs_direct_download_rights(service, mam):
    recorder = Recorder()
    recorder.allowed = False
    item_id = _mark(service, [_payload("r1")])
    report = SavedAutoGetter(service, recorder.hooks()).run_check()
    assert report.waiting[item_id] == "Needs approval: use Get to request it"
    assert recorder.queued == []


def test_earlier_items_get_the_free_slots_first(service, mam, monkeypatch):
    recorder = Recorder()
    first = _mark(service, [_payload("r1", torrent_id=1)])
    second = _mark(
        service,
        [_payload("r2", torrent_id=2)],
        book={**BOOK, "provider_id": "43", "title": "Second"},
    )

    def one_slot(releases):
        # One free slot: the first item is queued by the time the second is checked.
        fits = len(recorder.queued) + len(releases) <= 1
        return mam_account.BufferCheck(
            ok=fits, checked=True, request_bytes=0, unsat_ok=fits, request_count=len(releases)
        )

    monkeypatch.setattr(mam_account, "check_buffer", one_slot)
    report = SavedAutoGetter(service, recorder.hooks()).run_check()
    assert report.queued == [first]
    assert report.waiting[second] == "Waiting for unsatisfied slots"


def test_a_partly_failed_combined_pick_keeps_what_is_left(service, mam):
    recorder = Recorder()
    recorder.fail_ids = {"r2"}
    item_id = _mark(service, [_payload("r1", torrent_id=1), _payload("r2", torrent_id=2)])
    report = SavedAutoGetter(service, recorder.hooks()).run_check()
    assert report.queued == [item_id]
    item = service.get_item("user:1", item_id)
    assert item is not None
    assert [pick["release"]["source_id"] for pick in item["releases"]] == ["r2"]
    assert item["auto_get"] is False
    assert "source unavailable" in item["last_error"]


def test_releases_outside_mam_need_no_room(service, mam, monkeypatch):
    monkeypatch.setattr(mam_account, "is_configured", lambda: False)
    recorder = Recorder()
    item_id = _mark(service, [_payload("r1", torrent_id=None)])
    assert SavedAutoGetter(service, recorder.hooks()).run_check().queued == [item_id]


def test_the_global_switch_pauses_everything(service, mam, monkeypatch):
    monkeypatch.setattr(saved_autoget, "enabled", lambda: False)
    recorder = Recorder()
    _mark(service, [_payload("r1")])
    assert SavedAutoGetter(service, recorder.hooks()).run_check().checked == 0
    assert recorder.queued == []


def test_vip_freeleech_counts_only_for_vip_classes():
    assert mam_account.is_vip_class("VIP")
    assert mam_account.is_vip_class("Elite VIP")
    assert not mam_account.is_vip_class("Power User")
    assert not mam_account.is_vip_class(None)


def test_reads_one_torrent_by_id(monkeypatch):
    from shelfmark.release_sources.prowlarr.mam import MamClient

    sent: list[dict[str, Any]] = []

    def fake_get(_self, path, params=None):
        sent.append(dict(params or {}))
        return {"data": [{"id": "8", "free": "0"}, {"id": "7", "free": 1}]}

    monkeypatch.setattr(MamClient, "_get", fake_get)
    client = MamClient("cookie")
    assert client.get_torrent(7) == {"id": "7", "free": 1}
    assert sent[0]["tor[id]"] == "7"
    assert client.get_torrent(9) is None


def test_freeleech_flags(monkeypatch):
    class Client:
        item: dict[str, Any] | None = None

        def get_torrent(self, _torrent_id):
            return self.item

    client = Client()
    monkeypatch.setattr(mam_account, "_client", lambda: client)
    client.item = {"free": "1", "personal_freeleech": 0, "fl_vip": 0}
    assert mam_account.torrent_is_freeleech(1, vip=False)
    client.item = {"free": 0, "personal_freeleech": "1", "fl_vip": 0}
    assert mam_account.torrent_is_freeleech(1, vip=False)
    client.item = {"free": 0, "personal_freeleech": 0, "fl_vip": 1}
    assert not mam_account.torrent_is_freeleech(1, vip=False)
    assert mam_account.torrent_is_freeleech(1, vip=True)
    client.item = None
    with pytest.raises(MamError):
        mam_account.torrent_is_freeleech(1, vip=True)


def test_next_check_time(service, mam, monkeypatch):
    import threading
    import time as time_module

    getter = SavedAutoGetter(service, Recorder().hooks())
    assert getter.next_check_at() is None  # Not started

    # A running schedule reports when it wakes next; a marked item brings that forward.
    monkeypatch.setattr(getter, "_thread", threading.Thread(target=lambda: None))
    monkeypatch.setattr(getter._thread, "is_alive", lambda: True)
    getter._next_check_at = time_module.time() + 600
    assert getter.next_check_at() == pytest.approx(time_module.time() + 600, abs=2)
    monkeypatch.setattr(saved_autoget, "_SOON_DELAY_SECONDS", 3600)  # Keep the timer idle
    getter._next_check_at = time_module.time() + 7200
    getter.check_soon()
    assert getter.next_check_at() == pytest.approx(time_module.time() + 3600, abs=2)
    getter._soon.cancel()
    # Once the quick check has run, the schedule's own time is next again.
    monkeypatch.setattr(getter, "run_check", lambda: None)
    getter._run_soon()
    assert getter.next_check_at() == pytest.approx(time_module.time() + 7200, abs=2)

    monkeypatch.setattr(saved_autoget, "enabled", lambda: False)
    assert getter.next_check_at() is None
