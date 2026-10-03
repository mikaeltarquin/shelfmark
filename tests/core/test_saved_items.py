"""Saved for later: each user's books and picked releases to download later."""

import pytest
from flask import Flask

from shelfmark.core.saved_items import (
    NOAUTH_OWNER,
    SavedItemsService,
    book_key,
    normalize_conditions,
    user_owner,
)
from shelfmark.core.saved_routes import register_saved_routes

BOOK = {
    "id": "b1",
    "provider": "hardcover",
    "provider_id": "42",
    "title": "Book Title",
    "author": "Firstname Lastname",
}
RELEASE = {"source": "prowlarr", "source_id": "r1", "title": "Book Title [EPUB]"}


@pytest.fixture
def service(tmp_path):
    svc = SavedItemsService(str(tmp_path / "users.db"))
    svc.initialize()
    return svc


class TestService:
    def test_saves_a_book_without_a_release(self, service):
        item = service.save("user:1", book=BOOK, content_type="ebook")
        assert item["kind"] == "book"
        assert item["book_key"] == "hardcover:42"
        assert item["title"] == "Book Title"
        assert item["releases"] == []
        assert item["auto_get"] is False

    def test_saves_a_picked_release_and_a_combined_pick(self, service):
        single = service.save(
            "user:1",
            book=BOOK,
            content_type="ebook",
            releases=[{"content_type": "ebook", "release": RELEASE}],
        )
        assert single["kind"] == "release"
        combined = service.save(
            "user:2",
            book=BOOK,
            content_type="combined",
            releases=[
                {"content_type": "ebook", "release": RELEASE},
                {"content_type": "audiobook", "release": {**RELEASE, "source_id": "r2"}},
            ],
        )
        assert combined["kind"] == "combined"
        assert len(combined["releases"]) == 2

    def test_a_book_is_saved_once_and_keeps_its_pick(self, service):
        picked = service.save(
            "user:1",
            book=BOOK,
            content_type="ebook",
            releases=[{"content_type": "ebook", "release": RELEASE}],
        )
        again = service.save("user:1", book=BOOK, content_type="ebook")
        assert again["id"] == picked["id"]
        assert again["kind"] == "release"  # saving the book alone doesn't lose the pick
        repicked = service.save(
            "user:1",
            book=BOOK,
            content_type="ebook",
            releases=[{"content_type": "ebook", "release": {**RELEASE, "source_id": "r9"}}],
        )
        assert repicked["id"] == picked["id"]
        assert repicked["releases"][0]["release"]["source_id"] == "r9"
        assert len(service.list_items("user:1")) == 1

    def test_lists_are_per_owner(self, service):
        service.save("user:1", book=BOOK, content_type="ebook")
        service.save("user:2", book={**BOOK, "provider_id": "7"}, content_type="ebook")
        assert [i["book_key"] for i in service.list_items("user:1")] == ["hardcover:42"]
        item = service.list_items("user:2")[0]
        assert service.get_item("user:1", item["id"]) is None
        assert service.delete("user:1", item["id"]) is False
        assert service.delete("user:2", item["id"]) is True
        assert service.list_items("user:2") == []

    def test_rejects_bad_input(self, service):
        with pytest.raises(ValueError, match="content_type"):
            service.save("user:1", book=BOOK, content_type="video")
        with pytest.raises(ValueError, match="release record"):
            service.save(
                "user:1", book=BOOK, content_type="ebook", releases=[{"content_type": "ebook"}]
            )
        with pytest.raises(ValueError, match="id"):
            book_key({"title": "No id"})

    def test_auto_get_settings(self, service):
        item = service.save("user:1", book=BOOK, content_type="ebook")
        updated = service.update(
            "user:1",
            item["id"],
            auto_get=True,
            conditions={"freeleech_only": True, "min_ratio_enabled": True, "min_ratio": "2.5"},
        )
        assert updated is not None
        assert updated["auto_get"] is True
        assert updated["conditions"] == {
            "freeleech_only": True,
            "min_ratio_enabled": True,
            "min_ratio": 2.5,
        }


def test_conditions_default_to_a_ratio_of_two():
    assert normalize_conditions(None) == {
        "freeleech_only": False,
        "min_ratio_enabled": False,
        "min_ratio": 2.0,
    }
    assert (
        normalize_conditions({"min_ratio_enabled": True, "min_ratio": "oops"})["min_ratio"] == 2.0
    )
    assert normalize_conditions({"min_ratio_enabled": True, "min_ratio": -1})["min_ratio"] == 0.0


def test_owner_keys():
    assert user_owner(3) == "user:3"
    with pytest.raises(ValueError):
        user_owner(0)


def _app(service, auth_mode):
    app = Flask(__name__)
    app.secret_key = "test"
    register_saved_routes(app, service, lambda f: f, lambda: auth_mode)
    return app


class TestRoutes:
    def test_signed_in_users_have_their_own_lists(self, service):
        client = _app(service, "builtin").test_client()
        with client.session_transaction() as sess:
            sess["db_user_id"] = 5
        response = client.post("/api/saved", json={"book": BOOK, "content_type": "ebook"})
        assert response.status_code == 201
        item_id = response.get_json()["id"]
        assert [i["id"] for i in client.get("/api/saved").get_json()["items"]] == [item_id]
        assert service.list_items("user:5")[0]["id"] == item_id
        assert client.delete(f"/api/saved/{item_id}").status_code == 200
        assert client.delete(f"/api/saved/{item_id}").status_code == 404

    def test_no_login_shares_one_list(self, service):
        client = _app(service, "none").test_client()
        client.post("/api/saved", json={"book": BOOK, "content_type": "ebook"})
        assert len(service.list_items(NOAUTH_OWNER)) == 1

    def test_a_session_without_a_user_is_refused(self, service):
        client = _app(service, "builtin").test_client()
        assert client.get("/api/saved").status_code == 403

    def test_bad_requests(self, service):
        client = _app(service, "none").test_client()
        assert client.post("/api/saved", json={"book": "x"}).status_code == 400
        assert (
            client.post("/api/saved", json={"book": BOOK, "content_type": "video"}).status_code
            == 400
        )


def test_an_older_table_gains_the_new_columns(tmp_path):
    import sqlite3

    path = str(tmp_path / "users.db")
    conn = sqlite3.connect(path)
    conn.execute(
        """CREATE TABLE saved_items (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL,
           book_key TEXT NOT NULL, kind TEXT NOT NULL, content_type TEXT NOT NULL,
           title TEXT NOT NULL, author TEXT, book TEXT NOT NULL, releases TEXT NOT NULL
           DEFAULT '[]', payloads TEXT, auto_get INTEGER NOT NULL DEFAULT 0, conditions TEXT
           NOT NULL DEFAULT '{}', last_error TEXT, created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL, UNIQUE (owner, book_key))"""
    )
    conn.commit()
    conn.close()
    svc = SavedItemsService(path)
    svc.initialize()
    item = svc.save("user:1", book=BOOK, content_type="ebook")
    assert item["auto_status"] is None
    updated = svc.update("user:1", item["id"], auto_status="Waiting for freeleech")
    assert updated is not None
    assert updated["auto_status"] == "Waiting for freeleech"
    assert updated["auto_checked_at"]
    # A check's status alone doesn't count as an edit.
    assert updated["updated_at"] == item["updated_at"]


class TestAutoGetRoute:
    def _saved(self, client, *, payloads=True):
        body = {
            "book": BOOK,
            "content_type": "ebook",
            "releases": [{"content_type": "ebook", "release": RELEASE}],
        }
        if payloads:
            body["payloads"] = [{"source": "prowlarr", "source_id": "r1"}]
        return client.post("/api/saved", json=body).get_json()

    def test_marks_an_item_and_asks_for_a_check(self, service):
        calls = []
        app = Flask(__name__)
        app.secret_key = "test"
        register_saved_routes(
            app, service, lambda f: f, lambda: "none", on_auto_get=lambda: calls.append(1)
        )
        client = app.test_client()
        item = self._saved(client)
        assert item["has_payloads"] is True
        response = client.patch(
            f"/api/saved/{item['id']}",
            json={"auto_get": True, "conditions": {"freeleech_only": True}},
        )
        assert response.status_code == 200
        body = response.get_json()
        assert body["auto_get"] is True
        assert body["conditions"]["freeleech_only"] is True
        assert calls == [1]
        off = client.patch(f"/api/saved/{item['id']}", json={"auto_get": False}).get_json()
        assert off["auto_get"] is False
        assert calls == [1]

    def test_queues_picks_as_they_are_saved(self, service):
        calls = []
        app = Flask(__name__)
        app.secret_key = "test"
        register_saved_routes(
            app, service, lambda f: f, lambda: "none", on_auto_get=lambda: calls.append(1)
        )
        client = app.test_client()
        queued = client.post(
            "/api/saved",
            json={
                "book": BOOK,
                "content_type": "ebook",
                "releases": [{"content_type": "ebook", "release": RELEASE}],
                "payloads": [{"source": "prowlarr", "source_id": "r1"}],
                "auto_get": True,
            },
        ).get_json()
        assert queued["auto_get"] is True
        assert calls == [1]
        # A book alone can't be queued: it stays saved for later.
        later = client.post(
            "/api/saved",
            json={
                "book": {**BOOK, "provider_id": "other"},
                "content_type": "ebook",
                "auto_get": True,
            },
        ).get_json()
        assert later["auto_get"] is False
        assert calls == [1]

    def test_needs_a_pick_and_its_payloads(self, service):
        client = _app(service, "none").test_client()
        book_only = client.post("/api/saved", json={"book": BOOK, "content_type": "ebook"})
        book_id = book_only.get_json()["id"]
        assert client.patch(f"/api/saved/{book_id}", json={"auto_get": True}).status_code == 400
        item = self._saved(client, payloads=False)
        assert client.patch(f"/api/saved/{item['id']}", json={"auto_get": True}).status_code == 400
        sent = client.patch(
            f"/api/saved/{item['id']}",
            json={"auto_get": True, "payloads": [{"source": "prowlarr", "source_id": "r1"}]},
        )
        assert sent.status_code == 200
        mismatched = client.patch(f"/api/saved/{item['id']}", json={"payloads": [{}, {}]})
        assert mismatched.status_code == 400
        assert client.patch("/api/saved/999", json={"auto_get": True}).status_code == 404
