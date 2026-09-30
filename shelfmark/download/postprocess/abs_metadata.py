"""Write a `metadata.opf` into Audiobookshelf book folders.

Audiobookshelf builds a book's metadata from several sources, each overriding the one
before: folder names, audio tags or ebook metadata, `.nfo`, `desc.txt`/`reader.txt`,
an `.opf` file, then `metadata.json`. Release tags disagree from one upload to the next
(one names the series "Malazan Book of the Fallen Series", the next has none), so books
of one series import inconsistently.

An `.opf` holding Shelfmark's metadata for the book outranks the release's tags, so every
book gets the series and title Shelfmark shows. It ranks below `metadata.json` on
purpose: Audiobookshelf keeps its own copy of the metadata, including edits made in
Audiobookshelf, as a `metadata.json`, and a file Shelfmark wrote at that rank would undo
those edits on every rescan. The `.opf` is only read in full on the first scan, so it is
written before the book's files land.

Best effort: a failure is logged and never fails the download.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from xml.sax.saxutils import escape, quoteattr

import shelfmark.core.config as core_config
from shelfmark.core.logger import setup_logger
from shelfmark.core.naming import (
    AUTHOR_LIST_SEPARATOR,
    derive_primary_title,
    format_series_position,
    narrator_list,
    normalize_language_code,
)
from shelfmark.core.release_parts import part_title
from shelfmark.download.fs import atomic_write, run_blocking_io

from .policy import get_file_organization

if TYPE_CHECKING:
    from pathlib import Path

    from shelfmark.core.models import DownloadTask

logger = setup_logger(__name__)

OPF_FILENAME = "metadata.opf"


def is_enabled() -> bool:
    """Whether to write `metadata.opf` into audiobook folders."""
    if not core_config.config.get("WRITE_AUDIOBOOKSHELF_OPF", False):
        return False
    return get_file_organization(is_audiobook=True) == "organize"


def build_opf(task: DownloadTask, narrators: list[str] | None = None) -> str:
    """Render the task's book metadata as an OPF package Audiobookshelf reads."""
    title = derive_primary_title(task.title, task.subtitle) or task.title
    if task.release_part:  # One part of a book published in parts: "Title (1 of 2)"
        title = part_title(title, task.release_part, task.release_part_total)
    authors = [
        name for name in AUTHOR_LIST_SEPARATOR.split(" ".join((task.author or "").split())) if name
    ]
    lines = [f"    <dc:title>{escape(title)}</dc:title>"]
    if task.subtitle:
        lines.append(f"    <dc:subtitle>{escape(task.subtitle)}</dc:subtitle>")
    lines.extend(f'    <dc:creator opf:role="aut">{escape(name)}</dc:creator>' for name in authors)
    lines.extend(
        f'    <dc:creator opf:role="nrt">{escape(name)}</dc:creator>'
        for name in narrator_list(narrators)
    )
    if task.year:
        lines.append(f"    <dc:date>{escape(str(task.year))}</dc:date>")
    if language := normalize_language_code(task.language):
        lines.append(f"    <dc:language>{escape(language)}</dc:language>")
    if task.series_name:
        # Audiobookshelf pairs a series with the series_index directly after it.
        lines.append(f'    <meta name="calibre:series" content={quoteattr(task.series_name)}/>')
        if position := format_series_position(task.series_position):
            lines.append(f'    <meta name="calibre:series_index" content={quoteattr(position)}/>')
    body = "\n".join(lines)
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" version="2.0">\n'
        '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:opf="http://www.idpf.org/2007/opf">\n'
        f"{body}\n"
        "  </metadata>\n"
        "</package>\n"
    )


def write_book_opf(task: DownloadTask, directory: Path, narrators: list[str] | None) -> None:
    """Write `metadata.opf` into a book folder that has no `.opf` yet.

    An existing `.opf` is left alone: Audiobookshelf reads only one per folder, so a
    second would make which one wins arbitrary, and an earlier Shelfmark download of
    the same book already wrote the same metadata.
    """
    if not is_enabled():
        return

    def _write() -> None:
        directory.mkdir(parents=True, exist_ok=True)
        if any(path.suffix.lower() == ".opf" for path in directory.iterdir() if path.is_file()):
            return
        atomic_write(directory / OPF_FILENAME, build_opf(task, narrators).encode("utf-8"))
        logger.info("Task %s: wrote Audiobookshelf metadata to %s", task.task_id, directory)

    try:
        run_blocking_io(_write)
    except (OSError, RuntimeError, ValueError) as exc:
        logger.warning("Task %s: could not write %s: %s", task.task_id, directory, exc)
