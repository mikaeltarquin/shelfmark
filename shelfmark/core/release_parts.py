"""Which part of a book a release is, when a publisher splits one book into several.

GraphicAudio, for one, releases a book in parts, each its own torrent. MyAnonamouse
numbers them in the series field ("Elantris #1p2"); other sources only say so in the
title ("Elantris (Part 2 of 2)", "Elantris Pt. 2", "Elantris [2 of 3]"). Knowing the
part lets the files be named in reading order instead of in the order the downloads
happened to finish.
"""

from __future__ import annotations

import re

_MAX_PART = 99

# "#1p2", "#1 p2", "#1 pt 2", "#1 part 2" in a series field.
_SERIES_PART = re.compile(r"#\s*\d+(?:\.\d+)?\s*(?:p|pt\.?|part)\s*(\d+)\b", re.IGNORECASE)
# In a title: "Part 2", "Pt. 2", "(2 of 3)", "[2/3]".
_TITLE_PARTS = (
    re.compile(r"\b(?:part|pt\.?)\s*(\d+)\b", re.IGNORECASE),
    re.compile(r"[(\[]\s*(\d+)\s*(?:of|/)\s*\d+\s*[)\]]", re.IGNORECASE),
)


def _valid(value: str) -> int | None:
    number = int(value)
    return number if 1 <= number <= _MAX_PART else None


def release_part_number(title: object, series: object = None) -> int | None:
    """The part this release is (1, 2, ...), or None when it is a whole book."""
    if isinstance(series, str) and (match := _SERIES_PART.search(series)):
        return _valid(match.group(1))
    if isinstance(title, str):
        for pattern in _TITLE_PARTS:
            if match := pattern.search(title):
                return _valid(match.group(1))
    return None
