"""Tests for keeping ebooks in their audiobooks' folders (Audiobookshelf combined items)."""

from pathlib import Path

import pytest

from shelfmark.core.models import DownloadTask
from shelfmark.download.postprocess import policy
from shelfmark.download.postprocess.companions import colocate_ebooks_with_audiobooks

AUTHOR = "Robert Jordan"
TITLE = "The Eye of the World"
ABS_TEMPLATE = "{Author}/{Title}{ {Narrator}}/{Title}"


@pytest.fixture
def library(tmp_path, monkeypatch):
    values = {
        "EBOOKS_WITH_AUDIOBOOKS": True,
        "BOOKS_OUTPUT_MODE": "folder",
        "DESTINATION": str(tmp_path),
        "DESTINATION_AUDIOBOOK": str(tmp_path),
        "FILE_ORGANIZATION": "organize",
        "FILE_ORGANIZATION_AUDIOBOOK": "organize",
        "TEMPLATE_ORGANIZE": "{Author}/{Title}/{Title}",
        "TEMPLATE_AUDIOBOOK_ORGANIZE": ABS_TEMPLATE,
    }
    monkeypatch.setattr(
        policy.core_config.config,
        "get",
        lambda key, default=None, **_kwargs: values.get(key, default),
    )
    return values


def _task(content_type: str, narrators: list[str] | None = None, **kwargs) -> DownloadTask:
    return DownloadTask(
        task_id="t1",
        source="prowlarr",
        title=kwargs.pop("title", TITLE),
        author=AUTHOR,
        content_type=content_type,
        narrators=narrators,
        **kwargs,
    )


def _write(path: Path, data: bytes = b"x") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def _book_dir(root: Path, narrator: str | None = None, title: str = TITLE) -> Path:
    return root / AUTHOR / (f"{title} {{{narrator}}}" if narrator else title)


PIKE = "Rosamund Pike"
KRAMER = "Kate Reading & Michael Kramer"


class TestEbookArrives:
    def test_goes_into_every_narration_and_ebook_only_folder_is_removed(self, tmp_path, library):
        for narrator in (PIKE, KRAMER):
            _write(_book_dir(tmp_path, narrator) / f"{TITLE}.m4b")
        epub = _write(_book_dir(tmp_path) / f"{TITLE}.epub", b"ebook")

        final = colocate_ebooks_with_audiobooks(_task("ebook"), [epub])

        for narrator in (PIKE, KRAMER):
            assert (_book_dir(tmp_path, narrator) / f"{TITLE}.epub").read_bytes() == b"ebook"
        assert not _book_dir(tmp_path).exists()
        assert final == [_book_dir(tmp_path, KRAMER) / f"{TITLE}.epub"]

    def test_without_audiobook_goes_to_narratorless_folder(self, tmp_path, library):
        library["DESTINATION"] = str(tmp_path / "ebooks")
        library["DESTINATION_AUDIOBOOK"] = str(tmp_path / "audio")
        epub = _write(tmp_path / "ebooks" / AUTHOR / TITLE / f"{TITLE}.epub")

        final = colocate_ebooks_with_audiobooks(_task("ebook"), [epub])

        assert (_book_dir(tmp_path / "audio") / f"{TITLE}.epub").exists()
        assert epub.exists()
        assert final == [epub]

    def test_without_audiobook_in_shared_folder_is_left_alone(self, tmp_path, library):
        epub = _write(_book_dir(tmp_path) / f"{TITLE}.epub")

        assert colocate_ebooks_with_audiobooks(_task("ebook"), [epub]) == [epub]
        assert [p.name for p in _book_dir(tmp_path).iterdir()] == [f"{TITLE}.epub"]

    def test_legacy_audiobook_folder_without_narrator(self, tmp_path, library):
        library["DESTINATION"] = str(tmp_path / "ebooks")
        library["DESTINATION_AUDIOBOOK"] = str(tmp_path / "audio")
        _write(_book_dir(tmp_path / "audio") / f"{TITLE}.m4b")
        epub = _write(tmp_path / "ebooks" / AUTHOR / TITLE / f"{TITLE}.epub")

        colocate_ebooks_with_audiobooks(_task("ebook"), [epub])

        assert (_book_dir(tmp_path / "audio") / f"{TITLE}.epub").exists()
        assert epub.exists()


class TestAudiobookArrives:
    def test_absorbs_ebook_only_folder(self, tmp_path, library):
        ebook_only = _book_dir(tmp_path)
        _write(ebook_only / f"{TITLE}.epub", b"ebook")
        _write(ebook_only / "cover.jpg")
        _write(ebook_only / "metadata.json")
        m4b = _write(_book_dir(tmp_path, PIKE) / f"{TITLE}.m4b")

        final = colocate_ebooks_with_audiobooks(_task("audiobook", [PIKE]), [m4b])

        assert (_book_dir(tmp_path, PIKE) / f"{TITLE}.epub").read_bytes() == b"ebook"
        assert not ebook_only.exists()
        assert final == [m4b]

    def test_ebook_only_folder_with_other_files_is_kept(self, tmp_path, library):
        ebook_only = _book_dir(tmp_path)
        _write(ebook_only / f"{TITLE}.epub")
        _write(ebook_only / "notes.txt")
        m4b = _write(_book_dir(tmp_path, PIKE) / f"{TITLE}.m4b")

        colocate_ebooks_with_audiobooks(_task("audiobook", [PIKE]), [m4b])

        assert (_book_dir(tmp_path, PIKE) / f"{TITLE}.epub").exists()
        assert [p.name for p in ebook_only.iterdir()] == ["notes.txt"]

    def test_second_narration_copies_ebook_from_first(self, tmp_path, library):
        _write(_book_dir(tmp_path, PIKE) / f"{TITLE}.m4b")
        _write(_book_dir(tmp_path, PIKE) / f"{TITLE}.epub", b"ebook")
        m4b = _write(_book_dir(tmp_path, KRAMER) / f"{TITLE}.m4b")

        colocate_ebooks_with_audiobooks(
            _task("audiobook", ["Kate Reading", "Michael Kramer"]), [m4b]
        )

        assert (_book_dir(tmp_path, KRAMER) / f"{TITLE}.epub").read_bytes() == b"ebook"

    def test_unknown_narrator_folder_gets_ebook(self, tmp_path, library):
        _write(_book_dir(tmp_path, PIKE) / f"{TITLE}.m4b")
        _write(_book_dir(tmp_path, PIKE) / f"{TITLE}.epub")
        m4b = _write(_book_dir(tmp_path, "Audiobook") / f"{TITLE}.m4b")

        colocate_ebooks_with_audiobooks(_task("audiobook"), [m4b])

        assert (_book_dir(tmp_path, "Audiobook") / f"{TITLE}.epub").exists()

    def test_takes_ebook_from_separate_ebook_library(self, tmp_path, library):
        library["DESTINATION"] = str(tmp_path / "ebooks")
        library["DESTINATION_AUDIOBOOK"] = str(tmp_path / "audio")
        library_epub = _write(tmp_path / "ebooks" / AUTHOR / TITLE / f"{TITLE}.epub")
        m4b = _write(_book_dir(tmp_path / "audio", PIKE) / f"{TITLE}.m4b")

        colocate_ebooks_with_audiobooks(_task("audiobook", [PIKE]), [m4b])

        assert (_book_dir(tmp_path / "audio", PIKE) / f"{TITLE}.epub").exists()
        assert library_epub.exists()


class TestScope:
    def test_other_books_are_not_matched(self, tmp_path, library):
        title = "Dune [Deluxe]"
        _write(_book_dir(tmp_path, PIKE, title="Dune [Deluxe] Messiah") / "x.m4b")
        _write(_book_dir(tmp_path, PIKE, title="Dune D") / "x.m4b")
        epub = _write(_book_dir(tmp_path, title=title) / f"{title}.epub")

        colocate_ebooks_with_audiobooks(_task("ebook", title=title), [epub])

        assert epub.exists()
        assert not list(tmp_path.rglob("*Messiah*/*.epub"))
        assert not list(tmp_path.rglob("Dune D */*.epub"))

    def test_bracketed_title_matches_its_own_narration(self, tmp_path, library):
        title = "Dune [Deluxe]"
        _write(_book_dir(tmp_path, PIKE, title=title) / f"{title}.m4b")
        epub = _write(tmp_path / "elsewhere" / f"{title}.epub")

        colocate_ebooks_with_audiobooks(_task("ebook", title=title), [epub])

        assert (_book_dir(tmp_path, PIKE, title=title) / f"{title}.epub").exists()

    def test_disabled_does_nothing(self, tmp_path, library):
        library["EBOOKS_WITH_AUDIOBOOKS"] = False
        _write(_book_dir(tmp_path, PIKE) / f"{TITLE}.m4b")
        epub = _write(_book_dir(tmp_path) / f"{TITLE}.epub")

        colocate_ebooks_with_audiobooks(_task("ebook"), [epub])

        assert epub.exists()
        assert not (_book_dir(tmp_path, PIKE) / f"{TITLE}.epub").exists()

    def test_requires_organize_mode(self, tmp_path, library):
        library["FILE_ORGANIZATION_AUDIOBOOK"] = "rename"
        _write(_book_dir(tmp_path, PIKE) / f"{TITLE}.m4b")
        epub = _write(_book_dir(tmp_path) / f"{TITLE}.epub")

        colocate_ebooks_with_audiobooks(_task("ebook"), [epub])

        assert not (_book_dir(tmp_path, PIKE) / f"{TITLE}.epub").exists()

    @pytest.mark.parametrize(
        "template", ["{Author}/{Title}{ - Narrator}", "{Title}{ {Narrator}}", "{Author}/{Year}/x"]
    )
    def test_requires_a_per_book_folder(self, tmp_path, library, template):
        library["TEMPLATE_AUDIOBOOK_ORGANIZE"] = template
        library["DESTINATION"] = str(tmp_path / "ebooks")
        other = _write(tmp_path / AUTHOR / "Another Book.epub")
        _write(tmp_path / AUTHOR / f"{TITLE} - {PIKE}.m4b")
        epub = _write(tmp_path / "ebooks" / f"{TITLE}.epub")

        assert colocate_ebooks_with_audiobooks(_task("ebook"), [epub]) == [epub]
        assert sorted(p.name for p in (tmp_path / AUTHOR).iterdir()) == [
            "Another Book.epub",
            f"{TITLE} - {PIKE}.m4b",
        ]
        assert other.exists()

    def test_skips_packs(self, tmp_path, library):
        _write(_book_dir(tmp_path, PIKE) / f"{TITLE}.m4b")
        epub = _write(_book_dir(tmp_path) / f"{TITLE}.epub")

        colocate_ebooks_with_audiobooks(_task("ebook", multi_book=True), [epub])

        assert not (_book_dir(tmp_path, PIKE) / f"{TITLE}.epub").exists()

    def test_uses_hardlink_on_same_filesystem(self, tmp_path, library):
        _write(_book_dir(tmp_path, PIKE) / f"{TITLE}.m4b")
        library["DESTINATION"] = str(tmp_path / "ebooks")
        epub = _write(tmp_path / "ebooks" / AUTHOR / TITLE / f"{TITLE}.epub")

        colocate_ebooks_with_audiobooks(_task("ebook"), [epub])

        placed = _book_dir(tmp_path, PIKE) / f"{TITLE}.epub"
        assert placed.stat().st_ino == epub.stat().st_ino


class TestEbookQueuedWithAudiobooks:
    """The combined flow: the ebook knows which audiobooks are on their way."""

    def _transfer(self, tmp_path: Path, task: DownloadTask, name: str) -> list[Path]:
        from shelfmark.download.postprocess.transfer import transfer_book_files

        source = _write(tmp_path / "incoming" / name, b"ebook")
        final, error, _ops = transfer_book_files(
            [source],
            destination=tmp_path / "library",
            task=task,
            use_hardlink=False,
            is_torrent=False,
            organization_mode="organize",
            source_root=source.parent,
        )
        assert error is None
        return colocate_ebooks_with_audiobooks(task, final)

    @pytest.fixture
    def shared(self, tmp_path, library):
        library["DESTINATION"] = str(tmp_path / "library")
        library["DESTINATION_AUDIOBOOK"] = str(tmp_path / "library")
        return tmp_path / "library"

    def test_ebook_goes_straight_to_the_narrator_folder(self, tmp_path, shared):
        task = _task("ebook", companion_narrators=[[PIKE]])

        final = self._transfer(tmp_path, task, "download.epub")

        assert final == [_book_dir(shared, PIKE) / f"{TITLE}.epub"]
        assert not _book_dir(shared).exists()

    def test_ebook_goes_into_every_queued_narration(self, tmp_path, shared):
        task = _task("ebook", companion_narrators=[[PIKE], ["Kate Reading", "Michael Kramer"]])

        self._transfer(tmp_path, task, "download.epub")

        for narrator in (PIKE, KRAMER):
            assert (_book_dir(shared, narrator) / f"{TITLE}.epub").read_bytes() == b"ebook"
        assert not _book_dir(shared).exists()

    def test_audiobook_without_narrator_gets_placeholder_folder(self, tmp_path, shared):
        final = self._transfer(tmp_path, _task("ebook", companion_narrators=[[]]), "d.epub")

        assert final == [_book_dir(shared, "Audiobook") / f"{TITLE}.epub"]

    def test_audiobook_arriving_later_joins_the_folder(self, tmp_path, shared):
        self._transfer(tmp_path, _task("ebook", companion_narrators=[[PIKE]]), "d.epub")
        m4b = _write(_book_dir(shared, PIKE) / f"{TITLE}.m4b")

        colocate_ebooks_with_audiobooks(_task("audiobook", [PIKE]), [m4b])

        assert sorted(p.name for p in _book_dir(shared, PIKE).iterdir()) == [
            f"{TITLE}.epub",
            f"{TITLE}.m4b",
        ]
        assert sorted(p.name for p in (shared / AUTHOR).iterdir()) == [f"{TITLE} {{{PIKE}}}"]

    def test_existing_ebook_only_folder_is_absorbed(self, tmp_path, shared):
        _write(_book_dir(shared) / f"{TITLE}.pdf", b"old")

        self._transfer(tmp_path, _task("ebook", companion_narrators=[[PIKE]]), "d.epub")

        assert not _book_dir(shared).exists()
        assert sorted(p.name for p in _book_dir(shared, PIKE).iterdir()) == [
            f"{TITLE}.epub",
            f"{TITLE}.pdf",
        ]

    def test_separate_ebook_library_keeps_its_copy(self, tmp_path, library):
        library["DESTINATION"] = str(tmp_path / "library")
        library["DESTINATION_AUDIOBOOK"] = str(tmp_path / "audio")
        task = _task("ebook", companion_narrators=[[PIKE]])

        final = self._transfer(tmp_path, task, "d.epub")

        assert final == [_book_dir(tmp_path / "library") / f"{TITLE}.epub"]
        assert (_book_dir(tmp_path / "audio", PIKE) / f"{TITLE}.epub").exists()
        assert not _book_dir(tmp_path / "audio").exists()

    def test_disabled_keeps_the_normal_path(self, tmp_path, shared, library):
        library["EBOOKS_WITH_AUDIOBOOKS"] = False

        final = self._transfer(tmp_path, _task("ebook", companion_narrators=[[PIKE]]), "d.epub")

        assert final == [_book_dir(shared) / f"{TITLE}.epub"]
        assert not _book_dir(shared, PIKE).exists()
