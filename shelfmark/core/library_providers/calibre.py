"""Calibre library provider.

Reads a Calibre ``metadata.db`` (plain Calibre, Calibre-Web or Calibre-Web Automated)
read-only and indexes each book's title, authors, series and identifiers.

The database is opened with ``mode=ro`` first: on a WAL-mode library that sees the
un-checkpointed writes as long as the ``-wal``/``-shm`` files beside it are visible.
When that open fails (typically a read-only mount where SQLite cannot create those
files, or a locked database) it is retried once with ``immutable=1``, a snapshot that
can lag until Calibre next checkpoints. The file mtime is the change fingerprint, so a
write or checkpoint refreshes the index ahead of the cache TTL.
"""

from __future__ import annotations

import re
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from shelfmark.core.config import config as app_config
from shelfmark.core.library_providers import LibraryEntry, LibraryFile, LibraryItem, setting
from shelfmark.core.logger import setup_logger
from shelfmark.core.text_match import isbn_variants, tokens

if TYPE_CHECKING:
    from collections.abc import Mapping

logger = setup_logger(__name__)

# "(Alex Cross Series #11)", "[Illustrated Edition]" and friends.
_PARENTHETICAL = re.compile(r"[(\[][^)\]]*[)\]]")

_DEFAULT_DB_PATH = "/calibre-library/metadata.db"
_BUSY_TIMEOUT_SECONDS = 5

_ISBN_TYPES = frozenset({"isbn", "isbn13", "isbn-13", "isbn10", "isbn-10"})
_ASIN_TYPES = frozenset({"amazon", "mobi-asin", "asin"})
# Calibre identifier type -> Shelfmark metadata provider name.
_EXTERNAL_ID_TYPES = {
    "hardcover-id": "hardcover",
    "google": "googlebooks",
    "openlibrary": "openlibrary",
    "olid": "openlibrary",
}

_BOOKS_SQL = "SELECT id, title FROM books"
_BOOK_DETAILS_SQL = "SELECT id, timestamp, pubdate, has_cover, path, series_index FROM books"
_AUTHORS_SQL = "SELECT l.book, a.name FROM books_authors_link l JOIN authors a ON a.id = l.author"
_SERIES_SQL = "SELECT l.book, s.name FROM books_series_link l JOIN series s ON s.id = l.series"
_IDENTIFIERS_SQL = "SELECT book, type, val FROM identifiers"
_DATA_SQL = "SELECT book, format, name, uncompressed_size FROM data"


def _db_path(overrides: Mapping[str, Any] | None = None) -> Path:
    return Path(
        str(
            setting(app_config, "CALIBRE_LIBRARY_DB_PATH", _DEFAULT_DB_PATH, overrides)
            or _DEFAULT_DB_PATH
        )
    )


def _probe(conn: sqlite3.Connection) -> sqlite3.Connection:
    """Force the first read so open failures surface here rather than mid-query."""
    try:
        conn.execute("PRAGMA schema_version").fetchone()
    except sqlite3.Error:
        conn.close()
        raise
    return conn


def _connect(path: Path) -> sqlite3.Connection:
    uri = f"{path.absolute().as_uri()}?mode=ro"
    try:
        conn = _probe(sqlite3.connect(uri, uri=True, timeout=_BUSY_TIMEOUT_SECONDS))
    except sqlite3.OperationalError as exc:
        logger.info(
            "library check: %s cannot be read in place (%s); using an immutable snapshot, "
            "which may lag until Calibre checkpoints the library",
            path,
            exc,
        )
        conn = _probe(sqlite3.connect(f"{uri}&immutable=1", uri=True))
    return conn


def _timestamp(value: object) -> float | None:
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except ValueError:
        return None


def _pub_year(value: object) -> int | None:
    match = re.match(r"(\d{4})", str(value or ""))
    year = int(match.group(1)) if match else None
    return year if year and year > 1000 else None  # Calibre stores "0101-01-01" for unknown


def _series_number(value: object) -> str | None:
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    return f"{value:g}"


def _read_details(conn: sqlite3.Connection) -> dict[int, tuple[Any, ...]]:
    try:
        rows = conn.execute(_BOOK_DETAILS_SQL).fetchall()
    except sqlite3.Error:  # an unusual schema: the browser shows less, matching still works
        return {}
    return {row[0]: row[1:] for row in rows}


def _read_data(
    conn: sqlite3.Connection, book_id: int | None = None
) -> dict[int, list[tuple[str, str, int | None]]]:
    """Each book's (format, file name without extension, size) rows."""
    try:
        if book_id is None:
            rows = conn.execute(_DATA_SQL).fetchall()
        else:
            rows = conn.execute(f"{_DATA_SQL} WHERE book = ?", (book_id,)).fetchall()
    except sqlite3.Error:
        return {}
    data: dict[int, list[tuple[str, str, int | None]]] = {}
    for row_book, fmt, name, size in rows:
        if fmt and name:
            data.setdefault(row_book, []).append(
                (str(fmt).lower(), str(name), size if isinstance(size, int) and size > 0 else None)
            )
    return data


def _read_entries(conn: sqlite3.Connection, root: Path | None = None) -> list[LibraryEntry]:
    titles: dict[int, str] = dict(conn.execute(_BOOKS_SQL).fetchall())
    details = _read_details(conn)
    data = _read_data(conn)
    series: dict[int, str] = dict(conn.execute(_SERIES_SQL).fetchall())

    authors: dict[int, list[str]] = {}
    for book_id, name in conn.execute(_AUTHORS_SQL):
        authors.setdefault(book_id, []).append(name)

    isbns: dict[int, set[str]] = {}
    asins: dict[int, set[str]] = {}
    external_ids: dict[int, set[tuple[str, str]]] = {}
    for book_id, id_type, raw in conn.execute(_IDENTIFIERS_SQL):
        value = str(raw or "").strip()
        kind = str(id_type or "").strip().lower()
        if not value:
            continue
        if kind in _ISBN_TYPES:
            isbns.setdefault(book_id, set()).update(isbn_variants(value))
        elif kind in _ASIN_TYPES:
            asins.setdefault(book_id, set()).add(value.upper())
        elif provider := _EXTERNAL_ID_TYPES.get(kind):
            external_ids.setdefault(book_id, set()).add((provider, value))

    entries: list[LibraryEntry] = []
    for book_id, title in titles.items():
        # A trailing parenthetical is series or edition metadata by convention rather
        # than part of the work name, and Calibre users often put it there instead of
        # in the series field. It stays in the recall set below and is dropped from the
        # title set, which is what decides whether the shelf holds a different book.
        title_tok = set(tokens(_PARENTHETICAL.sub(" ", title)))
        context_tok = set(tokens(series.get(book_id)))
        for name in authors.get(book_id, ()):
            context_tok |= set(tokens(name))
        tok = title_tok | context_tok
        added, published, has_cover, folder, series_index = details.get(
            book_id, (None, None, False, None, None)
        )
        book_isbns = isbns.get(book_id, set())
        item = LibraryItem(
            source="calibre",
            item_id=str(book_id),
            title=title,
            authors=tuple(authors.get(book_id, ())),
            series=(
                ((series[book_id], _series_number(series_index)),) if book_id in series else ()
            ),
            added_at=_timestamp(added),
            year=_pub_year(published),
            has_cover=bool(has_cover),
            isbn=next((i for i in sorted(book_isbns) if len(i) == 13), None),
            path=str(root / folder) if root is not None and folder else folder or None,
            size=sum(size or 0 for _, _, size in data.get(book_id, ())) or None,
            file_formats=tuple(sorted({fmt for fmt, _, _ in data.get(book_id, ())})),
        )
        entries.append(
            LibraryEntry(
                frozenset(tok),
                frozenset(book_isbns),
                frozenset(asins.get(book_id, ())),
                frozenset(external_ids.get(book_id, ())),
                frozenset(title_tok),
                frozenset(context_tok),
                item=item,
            )
        )
    return entries


class CalibreLibrary:
    """Ebook ownership via a read-only Calibre ``metadata.db``."""

    name = "calibre"
    display_name = "Calibre"
    content_types = frozenset({"ebook"})

    def __init__(self, overrides: Mapping[str, Any] | None = None) -> None:
        self._overrides = overrides

    def is_enabled(self) -> bool:
        return bool(setting(app_config, "LIBRARY_CHECK_CALIBRE_ENABLED", False, self._overrides))

    def describe(self) -> str:
        return f"Calibre library at {_db_path(self._overrides)}"

    def fingerprint(self) -> float | None:
        path = _db_path(self._overrides)
        candidates = (path, path.with_name(f"{path.name}-wal"))
        return max((p.stat().st_mtime for p in candidates if p.exists()), default=None)

    def cover_path(self, item_id: str) -> Path | None:
        """The cover.jpg Calibre keeps in a book's folder, when the folder is mounted."""
        path = _db_path(self._overrides)
        if not item_id.isdigit() or not path.is_file():
            return None
        with closing(_connect(path)) as conn:
            row = conn.execute(
                "SELECT path, has_cover FROM books WHERE id = ?", (int(item_id),)
            ).fetchone()
        if not row or not row[1]:
            return None
        root = path.parent.resolve()
        cover = (root / str(row[0]) / "cover.jpg").resolve()
        return cover if cover.is_relative_to(root) and cover.is_file() else None

    def item_files(self, item_id: str) -> list[LibraryFile]:
        """A book's format files, at the paths beside ``metadata.db``."""
        path = _db_path(self._overrides)
        if not item_id.isdigit() or not path.is_file():
            return []
        with closing(_connect(path)) as conn:
            row = conn.execute("SELECT path FROM books WHERE id = ?", (int(item_id),)).fetchone()
            rows = _read_data(conn, int(item_id)).get(int(item_id), []) if row else []
        folder = path.parent / str(row[0]) if row else path.parent
        return [
            LibraryFile(
                name=f"{name}.{fmt}", path=str(folder / f"{name}.{fmt}"), kind="ebook", size=size
            )
            for fmt, name, size in sorted(rows)
        ]

    def fetch_entries(self) -> list[LibraryEntry]:
        path = _db_path(self._overrides)
        if not path.is_file():
            raise FileNotFoundError(f"No Calibre database at {path}")
        with closing(_connect(path)) as conn:
            return _read_entries(conn, path.parent)
