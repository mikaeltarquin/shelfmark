"""Tests for the metadata.opf written into Audiobookshelf book folders."""

import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from shelfmark.core.models import DownloadTask
from shelfmark.download.postprocess import policy, transfer
from shelfmark.download.postprocess.abs_metadata import build_opf
from shelfmark.download.postprocess.companions import colocate_ebooks_with_audiobooks
from shelfmark.download.postprocess.transfer import transfer_book_files

AUTHOR = "Steven Erikson"
SERIES = "Malazan Book of the Fallen"
NS = {"dc": "http://purl.org/dc/elements/1.1/", "opf": "http://www.idpf.org/2007/opf"}
OPF_ROLE = "{http://www.idpf.org/2007/opf}role"


@pytest.fixture
def library(tmp_path, monkeypatch):
    values = {
        "WRITE_AUDIOBOOKSHELF_OPF": True,
        "EBOOKS_WITH_AUDIOBOOKS": True,
        "BOOKS_OUTPUT_MODE": "folder",
        "DESTINATION": str(tmp_path / "library"),
        "DESTINATION_AUDIOBOOK": str(tmp_path / "library"),
        "FILE_ORGANIZATION": "organize",
        "FILE_ORGANIZATION_AUDIOBOOK": "organize",
        "TEMPLATE_ORGANIZE": "{Author}/{Title}/{Title}",
        "TEMPLATE_AUDIOBOOK_ORGANIZE": "{Author}/{Title} {{Narrator}}/{Title}",
    }
    monkeypatch.setattr(
        policy.core_config.config,
        "get",
        lambda key, default=None, **_kwargs: values.get(key, default),
    )
    return values


def _task(content_type: str, title: str = "Deadhouse Gates", **kwargs) -> DownloadTask:
    defaults = {
        "task_id": "t1",
        "source": "prowlarr",
        "title": title,
        "author": AUTHOR,
        "year": "2000",
        "language": "English",
        "series_name": SERIES,
        "series_position": 2.0,
        "content_type": content_type,
    }
    return DownloadTask(**{**defaults, **kwargs})


def _transfer(tmp_path: Path, task: DownloadTask, *names: str) -> list[Path]:
    sources = []
    for name in names:
        source = tmp_path / "incoming" / name
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"data")
        sources.append(source)
    final, error, _ops = transfer_book_files(
        sources,
        destination=tmp_path / "library",
        task=task,
        use_hardlink=False,
        is_torrent=False,
        organization_mode="organize",
        source_root=sources[0].parent,
    )
    assert error is None
    return colocate_ebooks_with_audiobooks(task, final)


def _folder(tmp_path: Path, name: str) -> Path:
    return tmp_path / "library" / AUTHOR / name


def _parse(path: Path) -> dict:
    metadata = ET.parse(path).getroot().find("{http://www.idpf.org/2007/opf}metadata")
    assert metadata is not None
    creators = metadata.findall("dc:creator", NS)
    meta = {m.get("name"): m.get("content") for m in metadata.findall("{*}meta")}
    return {
        "title": metadata.findtext("dc:title", namespaces=NS),
        "subtitle": metadata.findtext("dc:subtitle", namespaces=NS),
        "authors": [c.text for c in creators if c.get(OPF_ROLE) == "aut"],
        "narrators": [c.text for c in creators if c.get(OPF_ROLE) == "nrt"],
        "year": metadata.findtext("dc:date", namespaces=NS),
        "language": metadata.findtext("dc:language", namespaces=NS),
        "series": meta.get("calibre:series"),
        "series_index": meta.get("calibre:series_index"),
    }


class TestBuildOpf:
    def test_book_metadata(self, tmp_path):
        opf = tmp_path / "metadata.opf"
        opf.write_text(build_opf(_task("audiobook"), ["George Guidall"]))

        assert _parse(opf) == {
            "title": "Deadhouse Gates",
            "subtitle": None,
            "authors": [AUTHOR],
            "narrators": ["George Guidall"],
            "year": "2000",
            "language": "en",
            "series": SERIES,
            "series_index": "2",
        }

    def test_title_without_subtitle_suffix_and_several_authors(self, tmp_path):
        task = _task(
            "ebook",
            title="Gardens of the Moon: Malazan Book of the Fallen, Book 1",
            subtitle="Malazan Book of the Fallen, Book 1",
            author="Steven Erikson, Ian C. Esslemont",
            series_position=1.5,
        )
        opf = tmp_path / "metadata.opf"
        opf.write_text(build_opf(task))

        parsed = _parse(opf)
        assert parsed["title"] == "Gardens of the Moon"
        assert parsed["subtitle"] == "Malazan Book of the Fallen, Book 1"
        assert parsed["authors"] == [AUTHOR, "Ian C. Esslemont"]
        assert parsed["series_index"] == "1.5"

    def test_escapes_markup(self, tmp_path):
        task = _task("audiobook", title='Tom & Jerry <"Deluxe">', series_name='A "B" & C')
        opf = tmp_path / "metadata.opf"
        opf.write_text(build_opf(task))

        parsed = _parse(opf)
        assert parsed["title"] == 'Tom & Jerry <"Deluxe">'
        assert parsed["series"] == 'A "B" & C'

    def test_leaves_out_unknown_fields(self, tmp_path):
        task = _task("audiobook", year=None, language=None, series_name=None)
        opf = tmp_path / "metadata.opf"
        opf.write_text(build_opf(task))

        parsed = _parse(opf)
        assert (parsed["year"], parsed["language"], parsed["series"]) == (None, None, None)
        assert parsed["narrators"] == []


class TestAudiobookFolders:
    def test_written_before_the_audiobook_lands(self, tmp_path, library, monkeypatch):
        folder = _folder(tmp_path, "Deadhouse Gates {George Guidall}")
        original = transfer._transfer_single_file
        seen: list[bool] = []

        def spy(source, dest, **kwargs):
            seen.append((folder / "metadata.opf").exists())
            return original(source, dest, **kwargs)

        monkeypatch.setattr(transfer, "_transfer_single_file", spy)
        _transfer(tmp_path, _task("audiobook", narrators=["George Guidall"]), "dg.m4b")

        assert seen == [True]
        assert _parse(folder / "metadata.opf")["narrators"] == ["George Guidall"]

    def test_one_file_for_a_multi_part_audiobook(self, tmp_path, library):
        _transfer(tmp_path, _task("audiobook", narrators=["George Guidall"]), "1.mp3", "2.mp3")

        folder = _folder(tmp_path, "Deadhouse Gates {George Guidall}")
        assert sorted(p.name for p in folder.iterdir() if p.suffix == ".opf") == ["metadata.opf"]

    def test_unknown_narrator_is_not_written_as_a_narrator(self, tmp_path, library):
        _transfer(tmp_path, _task("audiobook"), "dg.m4b")

        assert (
            _parse(_folder(tmp_path, "Deadhouse Gates {Audiobook}") / "metadata.opf")["narrators"]
            == []
        )

    def test_existing_opf_is_left_alone(self, tmp_path, library):
        folder = _folder(tmp_path, "Deadhouse Gates {George Guidall}")
        folder.mkdir(parents=True)
        (folder / "release.opf").write_text("theirs")

        _transfer(tmp_path, _task("audiobook", narrators=["George Guidall"]), "dg.m4b")

        assert (folder / "release.opf").read_text() == "theirs"
        assert not (folder / "metadata.opf").exists()

    @pytest.mark.parametrize(
        ("key", "value"),
        [("WRITE_AUDIOBOOKSHELF_OPF", False), ("FILE_ORGANIZATION_AUDIOBOOK", "rename")],
    )
    def test_off(self, tmp_path, library, key, value):
        library[key] = value

        _transfer(tmp_path, _task("audiobook", narrators=["George Guidall"]), "dg.m4b")

        assert not list((tmp_path / "library").rglob("*.opf"))


class TestEbooksKeptWithAudiobooks:
    def test_queued_with_audiobooks_writes_each_narrators_folder(self, tmp_path, library):
        task = _task("ebook", companion_narrators=[["George Guidall"], ["Michael Page"]])

        _transfer(tmp_path, task, "dg.epub")

        for narrator in ("George Guidall", "Michael Page"):
            opf = _folder(tmp_path, f"Deadhouse Gates {{{narrator}}}") / "metadata.opf"
            assert _parse(opf)["narrators"] == [narrator]
            assert _parse(opf)["series"] == SERIES

    def test_ebook_only_folder_gets_one_and_loses_it_when_absorbed(self, tmp_path, library):
        _transfer(tmp_path, _task("ebook"), "dg.epub")
        ebook_only = _folder(tmp_path, "Deadhouse Gates")
        assert _parse(ebook_only / "metadata.opf")["narrators"] == []

        _transfer(tmp_path, _task("audiobook", narrators=["George Guidall"]), "dg.m4b")

        assert not ebook_only.exists()
        narrated = _folder(tmp_path, "Deadhouse Gates {George Guidall}")
        assert _parse(narrated / "metadata.opf")["narrators"] == ["George Guidall"]

    def test_separate_ebook_library_gets_none(self, tmp_path, library):
        library["DESTINATION"] = str(tmp_path / "ebooks")
        source = tmp_path / "incoming" / "dg.epub"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"data")
        task = _task("ebook", companion_narrators=[["George Guidall"]])

        final, _error, _ops = transfer_book_files(
            [source],
            destination=tmp_path / "ebooks",
            task=task,
            use_hardlink=False,
            is_torrent=False,
            organization_mode="organize",
        )
        colocate_ebooks_with_audiobooks(task, final)

        assert not list((tmp_path / "ebooks").rglob("*.opf"))
        assert (_folder(tmp_path, "Deadhouse Gates {George Guidall}") / "metadata.opf").exists()

    def test_ebooks_alone_need_colocation_on(self, tmp_path, library):
        library["EBOOKS_WITH_AUDIOBOOKS"] = False

        _transfer(tmp_path, _task("ebook"), "dg.epub")

        assert not list((tmp_path / "library").rglob("*.opf"))
