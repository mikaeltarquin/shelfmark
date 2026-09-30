"""Books released in parts (GraphicAudio) are filed in part order, not download order."""

from pathlib import Path

import pytest

from shelfmark.core.models import DownloadTask
from shelfmark.core.release_parts import ReleasePart, part_title, release_part
from shelfmark.download.postprocess import policy
from shelfmark.download.postprocess.transfer import transfer_book_files


class TestReleasePart:
    @pytest.mark.parametrize(
        ("title", "series", "expected"),
        [
            ("Elantris", "Elantris #1p2", ReleasePart(2)),
            ("Elantris", "Elantris #1 p1", ReleasePart(1)),
            ("Elantris", "The Cosmere #3, Elantris #1pt 3", ReleasePart(3)),
            ("Elantris (Part 2 of 2)", None, ReleasePart(2, 2)),
            ("Elantris Pt. 3", None, ReleasePart(3)),
            ("Elantris [2 of 3]", None, ReleasePart(2, 3)),
            ("Elantris (1/2) [GraphicAudio]", None, ReleasePart(1, 2)),
            # The series gives the part, the title the number of parts.
            ("Elantris (1 of 2) [Dramatized]", "Elantris #1p1", ReleasePart(1, 2)),
        ],
    )
    def test_detects_the_part(self, title, series, expected):
        assert release_part(title, series) == expected

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
        assert release_part(title, series) is None

    def test_series_number_wins_over_title(self):
        assert release_part("Elantris (Part 1 of 2)", "Elantris #1p2") == ReleasePart(2, 2)

    def test_part_title(self):
        assert part_title("Elantris", 1, 2) == "Elantris (1 of 2)"
        assert part_title("Elantris", 2, None) == "Elantris (Part 2)"
        # A release title that already says so is kept.
        assert part_title("Elantris (Part 1 of 2)", 1, 2) == "Elantris (Part 1 of 2)"


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


def _task(part: int | None, total: int | None = 2) -> DownloadTask:
    return DownloadTask(
        task_id=f"t{part}",
        source="prowlarr",
        title="Elantris",
        author="Brandon Sanderson",
        content_type="audiobook",
        narrators=["GraphicAudio"],
        release_part=part,
        release_part_total=total if part else None,
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


def test_each_part_is_its_own_book(tmp_path, config):
    # Part 2 finishes first; each part gets its own folder and title.
    assert _transfer(tmp_path, _task(2), ["b.m4b"], "organize") == [
        "Brandon Sanderson/Elantris (2 of 2) {GraphicAudio}/Elantris (2 of 2).m4b"
    ]
    assert _transfer(tmp_path, _task(1), ["a.m4b"], "organize") == [
        "Brandon Sanderson/Elantris (1 of 2) {GraphicAudio}/Elantris (1 of 2).m4b"
    ]


def test_unknown_number_of_parts(tmp_path, config):
    assert _transfer(tmp_path, _task(2, None), ["b.m4b"], "organize") == [
        "Brandon Sanderson/Elantris (Part 2) {GraphicAudio}/Elantris (Part 2).m4b"
    ]


def test_several_files_in_a_part(tmp_path, config):
    config["TEMPLATE_AUDIOBOOK_ORGANIZE"] = (
        "{Author}/{Title} {{Narrator}}/{Title}{ - Part }{PartNumber}"
    )
    assert _transfer(tmp_path, _task(2), ["01.mp3", "02.mp3"], "organize") == [
        "Brandon Sanderson/Elantris (2 of 2) {GraphicAudio}/Elantris (2 of 2) - Part 01.mp3",
        "Brandon Sanderson/Elantris (2 of 2) {GraphicAudio}/Elantris (2 of 2) - Part 02.mp3",
    ]


def test_opf_title_names_the_part(tmp_path, config):
    config["WRITE_AUDIOBOOKSHELF_OPF"] = True
    _transfer(tmp_path, _task(1), ["a.m4b"], "organize")
    opf = tmp_path / "library/Brandon Sanderson/Elantris (1 of 2) {GraphicAudio}/metadata.opf"
    assert "<dc:title>Elantris (1 of 2)</dc:title>" in opf.read_text()


def test_whole_books_are_unchanged(tmp_path, config):
    assert _transfer(tmp_path, _task(None), ["a.m4b"], "organize") == [
        "Brandon Sanderson/Elantris {GraphicAudio}/Elantris.m4b"
    ]


def test_rename_mode(tmp_path, config):
    assert _transfer(tmp_path, _task(2), ["b.m4b"], "rename") == [
        "Brandon Sanderson - Elantris (2 of 2).m4b"
    ]
    assert _transfer(tmp_path, _task(1), ["01.mp3", "02.mp3"], "rename") == [
        "Elantris (1 of 2) - 01.mp3",
        "Elantris (1 of 2) - 02.mp3",
    ]


def test_parts_skip_ebook_colocation(config):
    from shelfmark.download.postprocess.companions import is_enabled_for

    config["EBOOKS_WITH_AUDIOBOOKS"] = True
    assert is_enabled_for(_task(None))
    assert not is_enabled_for(_task(1))


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
            "title": "Elantris (2 of 2) [GraphicAudio]",
            "content_type": "audiobook",
            "extra": {"series": "Elantris #1p2"},
        },
    )
    assert (task.release_part, task.release_part_total) == (2, 2)
    restored = orchestrator._restore_task_from_retry_payload(
        orchestrator.serialize_task_for_retry(task)
    )
    assert restored is not None
    assert (restored.release_part, restored.release_part_total) == (2, 2)


def test_ebooks_have_no_part(monkeypatch):
    task = _queue(
        monkeypatch,
        {"source_id": "e", "title": "Elantris (Part 1 of 2)", "content_type": "ebook"},
    )
    assert task.release_part is None


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Elantris (1 of 2)", "Elantris"),
        ("Elantris (Part 2)", "Elantris"),
        ("Elantris [2/3]", "Elantris"),
        ("Elantris", "Elantris"),
        ("Book (Unabridged)", "Book (Unabridged)"),
        ("Catch-22", "Catch-22"),
    ],
)
def test_strip_part(title, expected):
    from shelfmark.core.release_parts import strip_part

    assert strip_part(title) == expected


def test_library_browser_shows_parts_as_one_book():
    from shelfmark.core.library_catalog import build_catalog
    from shelfmark.core.library_providers.audiobookshelf import (
        AudiobookshelfLibrary,
        entry_from_item,
    )

    def item(item_id: str, title: str, series: str) -> dict:
        return {
            "id": item_id,
            "media": {
                "numAudioFiles": 1,
                "metadata": {
                    "title": title,
                    "authorName": "Brandon Sanderson",
                    "seriesName": series,
                },
            },
        }

    entries = [
        entry_from_item(item("a", "Elantris (1 of 2)", "Elantris #1.1")),
        entry_from_item(item("b", "Elantris (2 of 2)", "Elantris #1.2")),
        entry_from_item(item("c", "Warbreaker", "Cosmere #1.5")),
    ]
    books = build_catalog([(AudiobookshelfLibrary(), [e for e in entries if e])])
    assert [b.title for b in books] == ["Elantris", "Warbreaker"]
    # The parts' series positions (1.1, 1.2) are the book's (1); a novella keeps 1.5.
    assert books[0].series == [{"name": "Elantris", "number": "1"}]
    assert books[1].series == [{"name": "Cosmere", "number": "1.5"}]


def test_queue_reads_the_part_from_the_release_title(monkeypatch):
    # The combined flow sends the book's title; the release's own title names the part
    # when the series field ("Stormlight Archive #2") does not.
    task = _queue(
        monkeypatch,
        {
            "source_id": "wor1",
            "title": "Words of Radiance",
            "release_title": "Words of Radiance (Part 1 of 5)",
            "content_type": "audiobook",
            "series_position": "2",
            "extra": {"series": "Stormlight Archive #2"},
        },
    )
    assert (task.release_part, task.release_part_total) == (1, 5)
    assert task.title == "Words of Radiance"
    assert task.series_position == 2.1


@pytest.mark.parametrize(
    ("position", "part", "expected"),
    [
        (2, ReleasePart(1, 5), 2.1),
        (2.0, ReleasePart(5, 5), 2.5),
        (2.0, ReleasePart(3), 2.3),
        # Ten or more parts take two decimals, so part 10 still sorts after part 9.
        (1, ReleasePart(1, 12), 1.01),
        (1, ReleasePart(10, 12), 1.1),
        (1, ReleasePart(12), 1.12),
        # A novella's position, or none at all, is kept.
        (1.5, ReleasePart(1, 2), 1.5),
        (None, ReleasePart(1, 2), None),
    ],
)
def test_part_series_position(position, part, expected):
    from shelfmark.core.release_parts import part_series_position

    assert part_series_position(position, part) == expected


def test_opf_carries_the_part_position(monkeypatch):
    from shelfmark.download.postprocess.abs_metadata import build_opf

    task = _queue(
        monkeypatch,
        {
            "source_id": "wor3",
            "title": "Words of Radiance",
            "release_title": "Words of Radiance (Part 3 of 5)",
            "content_type": "audiobook",
            "series_name": "The Stormlight Archive",
            "series_position": 2,
        },
    )
    opf = build_opf(task)
    assert '<meta name="calibre:series" content="The Stormlight Archive"/>' in opf
    assert '<meta name="calibre:series_index" content="2.3"/>' in opf
    assert "<dc:title>Words of Radiance (3 of 5)</dc:title>" in opf
