"""Books released in parts (GraphicAudio) are filed in part order, not download order."""

from pathlib import Path

import pytest

from shelfmark.core.models import DownloadTask
from shelfmark.core.release_parts import release_part_number
from shelfmark.download.postprocess import policy
from shelfmark.download.postprocess.transfer import transfer_book_files


class TestReleasePartNumber:
    @pytest.mark.parametrize(
        ("title", "series", "expected"),
        [
            ("Elantris", "Elantris #1p2", 2),
            ("Elantris", "Elantris #1 p1", 1),
            ("Elantris", "The Cosmere #3, Elantris #1pt 3", 3),
            ("Elantris (Part 2 of 2)", None, 2),
            ("Elantris Pt. 3", None, 3),
            ("Elantris [2 of 3]", None, 2),
            ("Elantris (1/2) [GraphicAudio]", None, 1),
        ],
    )
    def test_detects_the_part(self, title, series, expected):
        assert release_part_number(title, series) == expected

    @pytest.mark.parametrize(
        ("title", "series"),
        [
            ("Elantris", "Elantris #1"),
            ("The Way of Kings", "The Stormlight Archive #1"),
            ("Mistborn: The Final Empire", None),
            ("Part-Time Indian", None),
            ("Elantris Part 0", None),
        ],
    )
    def test_whole_books(self, title, series):
        assert release_part_number(title, series) is None

    def test_series_wins_over_title(self):
        assert release_part_number("Elantris (Part 1 of 2)", "Elantris #1p2") == 2


@pytest.fixture
def config(tmp_path, monkeypatch):
    values = {
        "BOOKS_OUTPUT_MODE": "folder",
        "DESTINATION_AUDIOBOOK": str(tmp_path / "library"),
        "FILE_ORGANIZATION_AUDIOBOOK": "organize",
        "TEMPLATE_AUDIOBOOK_ORGANIZE": "{Author}/{Title} {{Narrator}}/{Title}",
        "TEMPLATE_AUDIOBOOK_RENAME": "{Author} - {Title}",
    }
    monkeypatch.setattr(
        policy.core_config.config,
        "get",
        lambda key, default=None, **_kwargs: values.get(key, default),
    )
    return values


def _task(part: int | None) -> DownloadTask:
    return DownloadTask(
        task_id=f"t{part}",
        source="prowlarr",
        title="Elantris",
        author="Brandon Sanderson",
        content_type="audiobook",
        narrators=["GraphicAudio"],
        release_part=part,
    )


def _transfer(tmp_path: Path, task: DownloadTask, names: list[str], mode: str) -> list[str]:
    incoming = tmp_path / f"incoming{task.task_id}"
    incoming.mkdir()
    (tmp_path / "library").mkdir(exist_ok=True)
    sources = []
    for name in names:
        (incoming / name).write_bytes(b"data")
        sources.append(incoming / name)
    final, error, _ops = transfer_book_files(
        sources,
        destination=tmp_path / "library",
        task=task,
        use_hardlink=False,
        is_torrent=False,
        organization_mode=mode,
        source_root=incoming,
    )
    assert error is None
    return [str(path.relative_to(tmp_path / "library")) for path in final]


def test_parts_are_named_in_order_whichever_finishes_first(tmp_path, config):
    folder = "Brandon Sanderson/Elantris {GraphicAudio}"
    # Part 2 finishes first.
    assert _transfer(tmp_path, _task(2), ["b.m4b"], "organize") == [
        f"{folder}/Elantris - Part 02.m4b"
    ]
    assert _transfer(tmp_path, _task(1), ["a.m4b"], "organize") == [
        f"{folder}/Elantris - Part 01.m4b"
    ]


def test_several_files_in_a_part(tmp_path, config):
    assert _transfer(tmp_path, _task(2), ["01.mp3", "02.mp3"], "organize") == [
        "Brandon Sanderson/Elantris {GraphicAudio}/Elantris - Part 02-01.mp3",
        "Brandon Sanderson/Elantris {GraphicAudio}/Elantris - Part 02-02.mp3",
    ]


def test_template_part_number_carries_the_release_part(tmp_path, config):
    config["TEMPLATE_AUDIOBOOK_ORGANIZE"] = "{Author}/{Title}/{Title}{ - Part }{PartNumber}"
    assert _transfer(tmp_path, _task(2), ["b.m4b"], "organize") == [
        "Brandon Sanderson/Elantris/Elantris - Part 02.m4b"
    ]


def test_whole_books_are_unchanged(tmp_path, config):
    assert _transfer(tmp_path, _task(None), ["a.m4b"], "organize") == [
        "Brandon Sanderson/Elantris {GraphicAudio}/Elantris.m4b"
    ]


def test_rename_mode(tmp_path, config):
    assert _transfer(tmp_path, _task(2), ["b.m4b"], "rename") == [
        "Brandon Sanderson - Elantris - Part 02.m4b"
    ]
    assert _transfer(tmp_path, _task(3), ["01.mp3", "02.mp3"], "rename") == [
        "Part 03 - 01.mp3",
        "Part 03 - 02.mp3",
    ]


def _queue(monkeypatch, release: dict) -> DownloadTask:
    from shelfmark.download import orchestrator

    captured: dict[str, DownloadTask] = {}

    def fake_add(task: DownloadTask) -> bool:
        captured["task"] = task
        return True

    monkeypatch.setattr(orchestrator.config, "get", lambda _key, default=None, **_kw: default)
    monkeypatch.setattr(orchestrator, "_source_unavailable_message", lambda _source: None)
    monkeypatch.setattr(orchestrator.book_queue, "add", fake_add)
    monkeypatch.setattr(orchestrator, "ws_manager", None)
    ok, error = orchestrator.queue_release({"source": "direct_download", **release}, 0)
    assert ok, error
    return captured["task"]


def test_queue_reads_the_part_from_mam_series(monkeypatch):
    from shelfmark.download import orchestrator

    task = _queue(
        monkeypatch,
        {
            "source_id": "p2",
            "title": "Elantris",
            "content_type": "audiobook",
            "extra": {"series": "Elantris #1p2"},
        },
    )
    assert task.release_part == 2
    restored = orchestrator._restore_task_from_retry_payload(
        orchestrator.serialize_task_for_retry(task)
    )
    assert restored is not None
    assert restored.release_part == 2


def test_ebooks_have_no_part(monkeypatch):
    task = _queue(
        monkeypatch,
        {"source_id": "e", "title": "Elantris (Part 1 of 2)", "content_type": "ebook"},
    )
    assert task.release_part is None
