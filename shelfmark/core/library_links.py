"""Names for the header's library links, so a button says where it goes ("Audiobookshelf").

A name set in the settings wins. Otherwise it is read off the link: the Audiobookshelf
server Shelfmark is connected to, an app's name in the host ("abs.example.com",
"calibre-web"), its default port or path, and failing those the host itself.
"""

from __future__ import annotations

import ipaddress
import re
from urllib.parse import urlparse

# App names as they appear in a host, by the words they're written with.
_HOST_WORDS: tuple[tuple[frozenset[str], str], ...] = (
    (frozenset({"audiobookshelf", "abs"}), "Audiobookshelf"),
    (frozenset({"calibreweb", "cwa", "calibre"}), "Calibre-Web"),
    (frozenset({"plex"}), "Plex"),
    (frozenset({"jellyfin"}), "Jellyfin"),
    (frozenset({"emby"}), "Emby"),
    (frozenset({"kavita"}), "Kavita"),
    (frozenset({"komga"}), "Komga"),
    (frozenset({"booklore"}), "BookLore"),
    (frozenset({"grimmory"}), "Grimmory"),
    (frozenset({"jellyseerr"}), "Jellyseerr"),
)

# Default ports, for links by IP address.
_PORTS = {13378: "Audiobookshelf", 8083: "Calibre-Web", 32400: "Plex", 8096: "Jellyfin"}

# Audiobookshelf serves under /audiobookshelf behind many reverse proxies.
_PATHS = (("/audiobookshelf", "Audiobookshelf"), ("/calibre-web", "Calibre-Web"))


def _host_words(host: str) -> set[str]:
    words = set(re.split(r"[.\-_]+", host.lower()))
    # "calibre-web" is one app: join it before splitting on the hyphen loses that.
    if "calibre-web" in host.lower():
        words.add("calibreweb")
    return words


def _same_server(url: str, other: str) -> bool:
    a, b = urlparse(url), urlparse(other)
    return bool(a.hostname) and a.hostname == b.hostname and a.port == b.port


def library_link_name(
    url: object,
    override: object = None,
    *,
    audiobookshelf_url: object = None,
    fallback: str = "Library",
) -> str:
    """The name to show on a link to `url`."""
    if isinstance(override, str) and override.strip():
        return override.strip()
    text = url.strip() if isinstance(url, str) else ""
    if not text:
        return fallback
    if "://" not in text:
        text = f"http://{text}"
    parsed = urlparse(text)
    host = parsed.hostname or ""
    if isinstance(audiobookshelf_url, str) and audiobookshelf_url.strip():
        abs_url = audiobookshelf_url.strip()
        if "://" not in abs_url:
            abs_url = f"http://{abs_url}"
        if _same_server(text, abs_url):
            return "Audiobookshelf"
    words = _host_words(host)
    for names, name in _HOST_WORDS:
        if words & names:
            return name
    path = parsed.path.lower()
    for prefix, name in _PATHS:
        if path.startswith(prefix):
            return name
    try:
        port = parsed.port
    except ValueError:
        port = None
    if port in _PORTS:
        return _PORTS[port]
    if not host or host == "localhost":
        return fallback
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return host.removeprefix("www.")
    return fallback


def _with_scheme(url: str) -> str:
    url = url.strip().rstrip("/")
    return url if "://" in url else f"http://{url}"


def library_item_url(
    source: str,
    item_id: str,
    *,
    audiobookshelf_url: object = None,
    link_urls: tuple[object, ...] = (),
) -> str | None:
    """A link that opens one library item in the app that serves it, or None.

    ``link_urls`` are the header's library links. One that names the right app (by the
    rules of :func:`library_link_name`) wins, since it is the address a browser reaches;
    the Audiobookshelf server Shelfmark reads is the fallback for Audiobookshelf items.
    Calibre's book ids are Calibre-Web's, so a Calibre book opens there.
    """
    app, route = {
        "audiobookshelf": ("Audiobookshelf", "item"),
        "calibre": ("Calibre-Web", "book"),
    }.get(source, (None, None))
    if app is None or not item_id:
        return None
    for url in link_urls:
        if not isinstance(url, str) or not url.strip():
            continue
        if library_link_name(url, audiobookshelf_url=audiobookshelf_url) == app:
            return f"{_with_scheme(url)}/{route}/{item_id}"
    if (
        source == "audiobookshelf"
        and isinstance(audiobookshelf_url, str)
        and audiobookshelf_url.strip()
    ):
        return f"{_with_scheme(audiobookshelf_url)}/item/{item_id}"
    return None
