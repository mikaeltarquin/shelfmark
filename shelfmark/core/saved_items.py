"""Books saved to download later, per user.

A saved item is a book and, when one was picked, the exact releases to get: one release,
or a combined pick (an ebook and audiobooks). Each user has their own list; with no
login, everyone shares one. Items can be marked to download on their own once there is
room (see `mam_autoget`), with optional conditions.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from typing import Any

from shelfmark.core.request_helpers import now_utc_iso

NOAUTH_OWNER = "noauth:shared"
VALID_KINDS = frozenset({"book", "release", "combined"})
VALID_CONTENT_TYPES = frozenset({"ebook", "audiobook", "combined"})
# Ratio the account must keep after an automatic download, unless the user sets another.
DEFAULT_MIN_RATIO = 2.0

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS saved_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    owner         TEXT NOT NULL,
    book_key      TEXT NOT NULL,
    kind          TEXT NOT NULL,
    content_type  TEXT NOT NULL,
    title         TEXT NOT NULL,
    author        TEXT,
    book          TEXT NOT NULL,
    releases      TEXT NOT NULL DEFAULT '[]',
    payloads      TEXT,
    auto_get      INTEGER NOT NULL DEFAULT 0,
    conditions    TEXT NOT NULL DEFAULT '{}',
    last_error    TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    UNIQUE (owner, book_key)
);

CREATE INDEX IF NOT EXISTS idx_saved_items_owner_created
ON saved_items (owner, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_items_auto_get
ON saved_items (auto_get, created_at);
"""


def user_owner(user_id: int) -> str:
    """The owner key for a signed-in user."""
    if not isinstance(user_id, int) or user_id < 1:
        msg = "user_id must be a positive integer"
        raise ValueError(msg)
    return f"user:{user_id}"


def book_key(book: dict[str, Any]) -> str:
    """One saved item per book: its provider record, or its id when it has none."""
    provider = str(book.get("provider") or "").strip()
    provider_id = str(book.get("provider_id") or "").strip()
    if provider and provider_id:
        return f"{provider}:{provider_id}"
    raw_id = str(book.get("id") or "").strip()
    if not raw_id:
        msg = "book needs an id"
        raise ValueError(msg)
    return f"id:{raw_id}"


def normalize_conditions(raw: object) -> dict[str, Any]:
    """Automatic download conditions: freeleech only, and a minimum ratio afterwards."""
    data = raw if isinstance(raw, dict) else {}
    min_ratio: float | None = None
    if data.get("min_ratio_enabled"):
        try:
            min_ratio = float(data.get("min_ratio", DEFAULT_MIN_RATIO))
        except TypeError, ValueError:
            min_ratio = DEFAULT_MIN_RATIO
        min_ratio = max(0.0, min_ratio)
    return {
        "freeleech_only": bool(data.get("freeleech_only")),
        "min_ratio_enabled": min_ratio is not None,
        "min_ratio": DEFAULT_MIN_RATIO if min_ratio is None else min_ratio,
    }


def _loads(raw: object, default: Any) -> Any:
    if not isinstance(raw, str):
        return default
    try:
        return json.loads(raw)
    except ValueError:
        return default


def _row_to_item(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "book_key": row["book_key"],
        "kind": row["kind"],
        "content_type": row["content_type"],
        "title": row["title"],
        "author": row["author"],
        "book": _loads(row["book"], {}),
        "releases": _loads(row["releases"], []),
        "has_payloads": bool(row["payloads"]),
        "auto_get": bool(row["auto_get"]),
        "conditions": normalize_conditions(_loads(row["conditions"], {})),
        "last_error": row["last_error"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


class SavedItemsService:
    """SQLite storage for saved items, in the users database."""

    def __init__(self, db_path: str) -> None:
        """Use the SQLite database at `db_path`; call `initialize` before use."""
        self._db_path = db_path
        self._lock = threading.Lock()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def initialize(self) -> None:
        """Create the table if it doesn't exist."""
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(_CREATE_SQL)
                conn.commit()
            finally:
                conn.close()

    def list_items(self, owner: str) -> list[dict[str, Any]]:
        """An owner's saved items, newest first."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM saved_items WHERE owner = ? ORDER BY created_at DESC, id DESC",
                (owner,),
            ).fetchall()
            return [_row_to_item(row) for row in rows]
        finally:
            conn.close()

    def get_item(self, owner: str, item_id: int) -> dict[str, Any] | None:
        """One of an owner's saved items."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM saved_items WHERE owner = ? AND id = ?", (owner, item_id)
            ).fetchone()
            return _row_to_item(row) if row else None
        finally:
            conn.close()

    def save(
        self,
        owner: str,
        *,
        book: dict[str, Any],
        content_type: str,
        releases: list[dict[str, Any]] | None = None,
        payloads: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Save a book, with the releases picked for it if any.

        A book is saved once: saving it again with releases replaces what was picked,
        and saving it again without any keeps the earlier pick.
        """
        if content_type not in VALID_CONTENT_TYPES:
            msg = f"content_type must be one of: {', '.join(sorted(VALID_CONTENT_TYPES))}"
            raise ValueError(msg)
        picks = [r for r in releases or [] if isinstance(r, dict)]
        if any(not isinstance(r.get("release"), dict) for r in picks):
            msg = "each release needs its release record"
            raise ValueError(msg)
        kind = "book"
        if picks:
            kind = "combined" if content_type == "combined" or len(picks) > 1 else "release"
        key = book_key(book)
        title = str(book.get("title") or "Untitled")
        author = str(book.get("author") or "") or None
        now = now_utc_iso()
        with self._lock:
            conn = self._connect()
            try:
                existing = conn.execute(
                    "SELECT id, kind FROM saved_items WHERE owner = ? AND book_key = ?",
                    (owner, key),
                ).fetchone()
                if existing and not picks:
                    item_id = existing["id"]
                elif existing:
                    conn.execute(
                        """UPDATE saved_items SET kind = ?, content_type = ?, title = ?,
                           author = ?, book = ?, releases = ?, payloads = ?, last_error = NULL,
                           updated_at = ? WHERE id = ?""",
                        (
                            kind,
                            content_type,
                            title,
                            author,
                            json.dumps(book),
                            json.dumps(picks),
                            json.dumps(payloads) if payloads else None,
                            now,
                            existing["id"],
                        ),
                    )
                    item_id = existing["id"]
                else:
                    cursor = conn.execute(
                        """INSERT INTO saved_items (owner, book_key, kind, content_type, title,
                           author, book, releases, payloads, created_at, updated_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            owner,
                            key,
                            kind,
                            content_type,
                            title,
                            author,
                            json.dumps(book),
                            json.dumps(picks),
                            json.dumps(payloads) if payloads else None,
                            now,
                            now,
                        ),
                    )
                    item_id = int(cursor.lastrowid or 0)
                conn.commit()
                row = conn.execute("SELECT * FROM saved_items WHERE id = ?", (item_id,)).fetchone()
                return _row_to_item(row)
            finally:
                conn.close()

    def update(
        self,
        owner: str,
        item_id: int,
        *,
        auto_get: bool | None = None,
        conditions: object = None,
        payloads: list[dict[str, Any]] | None = None,
        last_error: str | None = None,
        clear_error: bool = False,
    ) -> dict[str, Any] | None:
        """Change an item's automatic download settings or note a failed attempt."""
        sets: list[str] = []
        values: list[Any] = []
        if auto_get is not None:
            sets.append("auto_get = ?")
            values.append(1 if auto_get else 0)
        if conditions is not None:
            sets.append("conditions = ?")
            values.append(json.dumps(normalize_conditions(conditions)))
        if payloads is not None:
            sets.append("payloads = ?")
            values.append(json.dumps(payloads) if payloads else None)
        if last_error is not None or clear_error:
            sets.append("last_error = ?")
            values.append(last_error)
        with self._lock:
            conn = self._connect()
            try:
                if sets:
                    sets.append("updated_at = ?")
                    values.append(now_utc_iso())
                    conn.execute(
                        f"UPDATE saved_items SET {', '.join(sets)} WHERE owner = ? AND id = ?",  # noqa: S608 - fixed column names
                        (*values, owner, item_id),
                    )
                    conn.commit()
                row = conn.execute(
                    "SELECT * FROM saved_items WHERE owner = ? AND id = ?", (owner, item_id)
                ).fetchone()
                return _row_to_item(row) if row else None
            finally:
                conn.close()

    def delete(self, owner: str, item_id: int) -> bool:
        """Remove one of an owner's saved items."""
        with self._lock:
            conn = self._connect()
            try:
                cursor = conn.execute(
                    "DELETE FROM saved_items WHERE owner = ? AND id = ?", (owner, item_id)
                )
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()
