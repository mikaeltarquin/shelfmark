"""The header's library links are named after where they go."""

import pytest

from shelfmark.core.library_links import library_item_url, library_link_name


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://abs.example.com", "Audiobookshelf"),
        ("https://audiobookshelf.example.com/", "Audiobookshelf"),
        ("http://192.168.1.5:13378", "Audiobookshelf"),
        ("https://example.com/audiobookshelf/", "Audiobookshelf"),
        ("https://calibre-web.example.com", "Calibre-Web"),
        ("http://cwa.lan:8083", "Calibre-Web"),
        ("http://10.0.0.2:8083", "Calibre-Web"),
        ("https://plex.example.com/web", "Plex"),
        ("https://kavita.example.com", "Kavita"),
        ("https://books.example.com", "books.example.com"),
        ("https://www.mylibrary.net", "mylibrary.net"),
        ("http://192.168.1.5:9000", "Library"),
        ("localhost:9000", "Library"),
    ],
)
def test_names_the_link_after_where_it_goes(url, expected):
    assert library_link_name(url) == expected


def test_a_name_from_the_settings_wins():
    assert library_link_name("https://abs.example.com", "  My Books  ") == "My Books"
    assert library_link_name("https://abs.example.com", "   ") == "Audiobookshelf"


def test_the_connected_audiobookshelf_server_is_recognised():
    assert (
        library_link_name("http://192.168.1.5:8080", audiobookshelf_url="192.168.1.5:8080")
        == "Audiobookshelf"
    )
    assert (
        library_link_name("http://192.168.1.5:9000", audiobookshelf_url="http://192.168.1.5:8080")
        == "Library"
    )


def test_no_url_falls_back():
    assert library_link_name("", fallback="Audiobooks") == "Audiobooks"
    assert library_link_name(None) == "Library"


def test_an_audiobookshelf_item_opens_at_the_header_link():
    assert (
        library_item_url(
            "audiobookshelf",
            "li_1",
            audiobookshelf_url="http://audiobookshelf:80",
            link_urls=("https://abs.example.com/", "http://cwa:8083"),
        )
        == "https://abs.example.com/item/li_1"
    )


def test_an_audiobookshelf_item_falls_back_to_the_connected_server():
    assert (
        library_item_url(
            "audiobookshelf",
            "li_1",
            audiobookshelf_url="audiobookshelf:80",
            link_urls=("https://plex.example.com", ""),
        )
        == "http://audiobookshelf:80/item/li_1"
    )


def test_a_calibre_book_opens_in_calibre_web_only():
    assert (
        library_item_url("calibre", "12", link_urls=("", "http://calibre-web.lan:8083/"))
        == "http://calibre-web.lan:8083/book/12"
    )
    assert library_item_url("calibre", "12", link_urls=("https://kavita.example.com",)) is None
    assert library_item_url("unknown", "12", link_urls=("http://cwa:8083",)) is None
