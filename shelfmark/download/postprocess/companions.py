"""Keep ebooks in the folders of their audiobooks for Audiobookshelf.

Audiobookshelf shows an ebook and an audiobook as one library item when they share a
folder. Narrations of the same book need their own folders (`{Narrator}` in the audiobook
path template, e.g. `The Eye of the World {Rosamund Pike}`), so the ebook has to be
copied into each of them.

Folders are found on disk from the audiobook path template rather than from download
history, so books that were already in the library before this ran are picked up too.
The template is rendered with a sentinel in place of the narrator and the folder that
holds it becomes a glob: every narration of the book matches it, other books do not.

- An ebook arriving goes into every audiobook folder of the book, or, with no audiobook
  yet, into the folder the template gives without a narrator.
- An audiobook arriving gets the ebook from a sibling narration's folder, that
  narrator-less folder, or the ebook library.
- Once an audiobook folder exists, the narrator-less ebook-only folder is emptied into
  it and removed, so Audiobookshelf is not left with a second, ebook-only item.

Best effort: a failure here is logged and never fails the download it follows.
"""

from __future__ import annotations

import glob
import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING

import shelfmark.core.config as core_config
from shelfmark.core.logger import setup_logger
from shelfmark.core.models import SearchMode
from shelfmark.core.naming import build_library_path
from shelfmark.core.utils import get_destination
from shelfmark.core.utils import is_audiobook as check_audiobook
from shelfmark.download.fs import atomic_hardlink, run_blocking_io

from .policy import (
    get_file_organization,
    get_supported_formats,
    get_template,
    get_word_separator,
)
from .transfer import build_metadata_dict, narrator_value

if TYPE_CHECKING:
    from pathlib import Path

    from shelfmark.core.models import DownloadTask

logger = setup_logger(__name__)

# Stands in for {Narrator} while rendering the folder glob. Letters only, so neither
# sanitizing nor the word separator can change it.
_NARRATOR_SENTINEL = "shelfmarknarratorslot"

_AUDIO_EXTENSIONS = frozenset(
    {".m4b", ".m4a", ".mp3", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wav", ".wma"}
)
_EXTRA_EBOOK_EXTENSIONS = frozenset({".epub", ".pdf", ".kepub"})

# What Audiobookshelf writes into a book folder by itself; removing an emptied
# ebook-only folder removes these too.
_ABS_SIDECAR_NAMES = frozenset(
    {"metadata.json", "cover.jpg", "cover.jpeg", "cover.png", "cover.webp"}
)


# An ebook and an audiobook of one book can finish at the same time (combined
# downloads); serialize so they do not both place a copy.
_colocate_lock = threading.Lock()


@dataclass(frozen=True)
class _BookLayout:
    root: Path  # Audiobook destination
    audiobook_dir_glob: str  # Every narration's folder, relative to root
    own_dir: Path  # This task's folder (its narrator, or none for an ebook)
    ebook_only_dir: Path  # The book's folder without a narrator
    file_stem: str  # Filename the template gives the book, without extension


def is_enabled_for(task: DownloadTask) -> bool:
    """Whether ebooks and audiobooks of this task's book should share folders."""
    if not core_config.config.get("EBOOKS_WITH_AUDIOBOOKS", False):
        return False
    if get_file_organization(is_audiobook=True) != "organize":
        return False
    if task.search_mode == SearchMode.DIRECT:
        return False
    return not (task.multi_book or task.book_plan)


def _ebook_extensions() -> frozenset[str]:
    return frozenset(f".{fmt}" for fmt in get_supported_formats()) | _EXTRA_EBOOK_EXTENSIONS


def _render(task: DownloadTask, template: str, root: Path, narrator: str) -> Path:
    metadata = build_metadata_dict(task)
    metadata["Narrator"] = narrator
    return build_library_path(str(root), template, metadata, word_separator=get_word_separator())


def _has_book_folder(template: str) -> bool:
    """Whether the template's innermost folder is per book, i.e. names the title.

    Without that the folder is shared by several books (e.g. `{Author}/{Title} - {Narrator}`
    puts every book in the author's folder), and picking or removing an ebook there
    could touch another book's.
    """
    segments = template.replace("\\", "/").split("/")
    return len(segments) > 1 and "title" in segments[-2].lower()


def _book_layout(task: DownloadTask) -> _BookLayout | None:
    template = get_template(is_audiobook=True, organization_mode="organize")
    if not _has_book_folder(template):
        logger.debug("Task %s: audiobook template has no per-book folder", task.task_id)
        return None
    root = get_destination(is_audiobook=True, user_id=task.user_id, username=task.username)
    root = root.resolve()

    pattern_path = _render(task, template, root, _NARRATOR_SENTINEL)
    if pattern_path.parent == root:
        return None

    relative_dir = str(pattern_path.parent.relative_to(root))
    audiobook_dir_glob = glob.escape(relative_dir).replace(_NARRATOR_SENTINEL, "*")

    narrator = narrator_value(task) if check_audiobook(task.content_type) else ""
    unnarrated = _render(task, template, root, "")
    return _BookLayout(
        root=root,
        audiobook_dir_glob=audiobook_dir_glob,
        own_dir=_render(task, template, root, narrator).parent,
        ebook_only_dir=unnarrated.parent,
        file_stem=unnarrated.name,
    )


def _files_in(directory: Path) -> list[Path]:
    def _list() -> list[Path]:
        if not directory.is_dir():
            return []
        return sorted(p for p in directory.iterdir() if p.is_file())

    return run_blocking_io(_list)


def _has_audio(directory: Path) -> bool:
    def _scan() -> bool:
        return directory.is_dir() and any(
            p.suffix.lower() in _AUDIO_EXTENSIONS for p in directory.rglob("*") if p.is_file()
        )

    return run_blocking_io(_scan)


def _ebooks_in(directory: Path, extensions: frozenset[str]) -> dict[str, Path]:
    ebooks: dict[str, Path] = {}
    for path in _files_in(directory):
        ext = path.suffix.lower()
        if ext in extensions:
            ebooks.setdefault(ext, path)
    return ebooks


def _find_audiobook_dirs(layout: _BookLayout) -> list[Path]:
    def _glob() -> list[Path]:
        return sorted(p for p in layout.root.glob(layout.audiobook_dir_glob) if p.is_dir())

    candidates = run_blocking_io(_glob)
    # An audiobook saved without a narrator folder (before {Narrator} was in the
    # template) is still an audiobook folder of this book.
    if layout.ebook_only_dir not in candidates and layout.ebook_only_dir != layout.root:
        candidates.append(layout.ebook_only_dir)
    return [d for d in candidates if _has_audio(d)]


def _ebook_library_sources(task: DownloadTask, extensions: frozenset[str]) -> dict[str, Path]:
    """Ebooks already at the path the ebook template gives this book."""
    if str(core_config.config.get("BOOKS_OUTPUT_MODE", "folder") or "folder") != "folder":
        return {}
    organization_mode = get_file_organization(is_audiobook=False)
    if organization_mode == "none":
        return {}
    template = get_template(is_audiobook=False, organization_mode=organization_mode)
    root = get_destination(is_audiobook=False, user_id=task.user_id, username=task.username)
    try:
        path = _render(task, template, root, "")
    except ValueError:
        return {}
    return {
        ext: candidate
        for ext in sorted(extensions)
        if run_blocking_io((candidate := path.parent / f"{path.name}{ext}").is_file)
    }


def _place(task: DownloadTask, sources: dict[str, Path], directory: Path, stem: str) -> None:
    """Link (or copy) each ebook format into `directory` unless it already has one."""
    present = {p.suffix.lower() for p in _files_in(directory)}
    for ext, source in sources.items():
        if ext in present or source.parent == directory:
            continue
        run_blocking_io(directory.mkdir, parents=True, exist_ok=True)
        placed = atomic_hardlink(source, directory / f"{stem}{ext}")
        logger.info("Task %s: placed ebook alongside audiobook: %s", task.task_id, placed)


def _absorb_ebook_only_dir(
    task: DownloadTask,
    layout: _BookLayout,
    audiobook_dirs: list[Path],
    extensions: frozenset[str],
    final_paths: list[Path],
) -> list[Path]:
    """Empty the narrator-less ebook-only folder into the audiobook folders and remove it."""
    ebook_only_dir = layout.ebook_only_dir
    if ebook_only_dir in audiobook_dirs or ebook_only_dir == layout.root:
        return final_paths
    if not run_blocking_io(ebook_only_dir.is_dir) or _has_audio(ebook_only_dir):
        return final_paths

    ebooks = _ebooks_in(ebook_only_dir, extensions)
    # Placed already in the common case; this covers a format only this folder had.
    _place(task, ebooks, audiobook_dirs[0], layout.file_stem)

    leftovers: list[Path] = []
    for path in _files_in(ebook_only_dir):
        if path.suffix.lower() in extensions or path.name.lower() in _ABS_SIDECAR_NAMES:
            run_blocking_io(path.unlink)
        else:
            leftovers.append(path)
    if leftovers:
        logger.warning(
            "Task %s: left ebook-only folder %s in place, it holds other files: %s",
            task.task_id,
            ebook_only_dir,
            ", ".join(p.name for p in leftovers),
        )
    else:
        try:
            run_blocking_io(ebook_only_dir.rmdir)
        except OSError as exc:
            logger.warning("Task %s: could not remove %s: %s", task.task_id, ebook_only_dir, exc)
        else:
            logger.info("Task %s: moved ebook-only folder %s", task.task_id, ebook_only_dir)

    # A path we just removed is not where the download ended up any more.
    moved_to = _ebooks_in(audiobook_dirs[0], extensions)
    return [
        moved_to.get(path.suffix.lower(), path) if path.parent == ebook_only_dir else path
        for path in final_paths
    ]


def _colocate(task: DownloadTask, final_paths: list[Path]) -> list[Path]:
    layout = _book_layout(task)
    if layout is None:
        return final_paths

    extensions = _ebook_extensions()
    audiobook_dirs = _find_audiobook_dirs(layout)
    is_audiobook = check_audiobook(task.content_type)

    if is_audiobook:
        if layout.own_dir not in audiobook_dirs and _has_audio(layout.own_dir):
            audiobook_dirs.append(layout.own_dir)
        # Order decides which copy wins: another narration's, then the ebook-only
        # folder, then the ebook library.
        sources = _ebook_library_sources(task, extensions)
        sources.update(_ebooks_in(layout.ebook_only_dir, extensions))
        for directory in reversed(audiobook_dirs):
            sources.update(_ebooks_in(directory, extensions))
    else:
        sources = {}
        for path in final_paths:
            sources.setdefault(path.suffix.lower(), path)
        sources = {ext: path for ext, path in sources.items() if ext in extensions}

    if not sources:
        return final_paths

    if audiobook_dirs:
        for directory in audiobook_dirs:
            _place(task, sources, directory, layout.file_stem)
        return _absorb_ebook_only_dir(task, layout, audiobook_dirs, extensions, final_paths)

    if not is_audiobook:
        _place(task, sources, layout.ebook_only_dir, layout.file_stem)
    return final_paths


def colocate_ebooks_with_audiobooks(task: DownloadTask, final_paths: list[Path]) -> list[Path]:
    """Share folders between a finished download and the other formats of its book.

    Returns `final_paths`, updated for any file that moved.
    """
    if not final_paths or not is_enabled_for(task):
        return final_paths
    try:
        with _colocate_lock:
            return _colocate(task, final_paths)
    except (OSError, RuntimeError, ValueError) as exc:
        logger.warning("Task %s: could not place ebook alongside audiobook: %s", task.task_id, exc)
        return final_paths
