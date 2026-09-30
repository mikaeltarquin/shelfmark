"""Which part of a book a release is, when a publisher splits one book into several.

GraphicAudio, for one, releases a book in parts, each its own torrent. MyAnonamouse
numbers them in the series field ("Elantris #1p2"); other sources only say so in the
title ("Elantris (Part 2 of 2)", "Elantris Pt. 2", "Elantris [2 of 3]"). Each part is
filed as its own book, "Elantris (2 of 2)", so Audiobookshelf keeps them apart.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from shelfmark.core.utils import is_audiobook

if TYPE_CHECKING:
    from shelfmark.core.models import DownloadTask

_MAX_PART = 99

# "#1p2", "#1 p2", "#1 pt 2", "#1 part 2" in a series field.
_SERIES_PART = re.compile(r"#\s*\d+(?:\.\d+)?\s*(?:p|pt\.?|part)\s*(\d+)\b", re.IGNORECASE)
# In a title, with the number of parts when it says: "Part 2 of 3", "(2 of 3)", "[2/3]",
# then without: "Part 2", "Pt. 2".
_TITLE_PART_OF = (
    re.compile(r"\b(?:part|pt\.?)\s*(\d+)\s*(?:of|/)\s*(\d+)\b", re.IGNORECASE),
    re.compile(r"[(\[]\s*(\d+)\s*(?:of|/)\s*(\d+)\s*[)\]]", re.IGNORECASE),
)
_TITLE_PART = re.compile(r"\b(?:part|pt\.?)\s*(\d+)\b", re.IGNORECASE)


@dataclass(frozen=True)
class ReleasePart:
    """Part `number` of a book, of `total` parts when the release says."""

    number: int
    total: int | None = None


def _number(value: str) -> int | None:
    number = int(value)
    return number if 1 <= number <= _MAX_PART else None


def release_part(title: object, series: object = None) -> ReleasePart | None:
    """The part this release is, or None when it is a whole book."""
    text = title if isinstance(title, str) else ""
    number: int | None = None
    total: int | None = None
    for pattern in _TITLE_PART_OF:
        if match := pattern.search(text):
            number, total = _number(match.group(1)), _number(match.group(2))
            break
    else:
        if match := _TITLE_PART.search(text):
            number = _number(match.group(1))
    # The series field is the more reliable number; the title may still give the total.
    if isinstance(series, str) and (match := _SERIES_PART.search(series)):
        number = _number(match.group(1))
    if number is None:
        return None
    if total is not None and total < number:
        total = None
    return ReleasePart(number, total)


def part_title(title: str, number: int, total: int | None) -> str:
    """ "Elantris" as part 1 of 2: "Elantris (1 of 2)", or "Elantris (Part 1)".

    A title that already names its part (a release title, "Elantris (Part 1 of 2)")
    is kept as it is.
    """
    if release_part(title) is not None:
        return title
    suffix = f"({number} of {total})" if total else f"(Part {number})"
    return f"{title} {suffix}"


def part_series_position(position: float | None, part: ReleasePart) -> float | None:
    """Book 2's part 1 as series position 2.1, so the parts sort in order in a series.

    Parts past the ninth take two decimals (2.01 ... 2.12) so they still sort in
    order. A position that is missing or already fractional (a novella, 1.5) is
    kept as it is.
    """
    if position is None or not float(position).is_integer():
        return position
    digits = 2 if max(part.number, part.total or 0) >= 10 else 1
    return round(position + part.number / 10**digits, digits)


_PART_SUFFIX = re.compile(
    r"\s*[(\[]\s*(?:(?:part|pt\.?)\s*)?\d+(?:\s*(?:of|/)\s*\d+)?\s*[)\]]\s*$", re.IGNORECASE
)


def strip_part(title: str) -> str:
    """ "Elantris (1 of 2)" or "Elantris (Part 1)" as the book: "Elantris"."""
    stripped = _PART_SUFFIX.sub("", title)
    return stripped or title


def book_title(task: DownloadTask) -> str:
    """The title a book is filed under: part releases get "Title (1 of 2)".

    A book published in parts (GraphicAudio) is one release per part. Filed under the
    plain title, the parts would share a folder, which Audiobookshelf reads as one
    item and cannot match; each part gets its own title, folder and item instead.
    """
    part = getattr(task, "release_part", None)
    if part and is_audiobook(task.content_type):
        return part_title(task.title, part, getattr(task, "release_part_total", None))
    return task.title
