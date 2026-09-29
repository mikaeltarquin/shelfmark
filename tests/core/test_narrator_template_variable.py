"""Tests for the {Narrator} template variable and literal braces in templates.

Audiobookshelf reads the narrator from a `{...}` part of the book folder name, and
separate narrations of one book need separate folders:
`Robert Jordan/The Eye of the World {Rosamund Pike}/The Eye of the World.m4b`.
"""

import pytest

from shelfmark.core.models import DownloadTask
from shelfmark.core.naming import (
    KNOWN_TOKENS,
    find_template_blocks,
    join_narrators,
    narrator_list,
    parse_naming_template,
)
from shelfmark.download.orchestrator import (
    _restore_task_from_retry_payload,
    serialize_task_for_retry,
)
from shelfmark.download.postprocess import policy
from shelfmark.download.postprocess.transfer import build_metadata_dict

ABS_TEMPLATE = "{Author}/{Title}{ {Narrator}}/{Title}"
BASE = {"Author": "Robert Jordan", "Title": "The Eye of the World"}


def _config(monkeypatch, values):
    monkeypatch.setattr(
        policy.core_config.config,
        "get",
        lambda key, default=None, **_kwargs: values.get(key, default),
    )


def _task(**kwargs) -> DownloadTask:
    defaults = {
        "task_id": "t1",
        "source": "prowlarr",
        "title": "The Eye of the World",
        "author": "Robert Jordan",
        "content_type": "audiobook",
    }
    return DownloadTask(**{**defaults, **kwargs})


class TestNarratorToken:
    def test_narrator_in_known_tokens(self):
        assert "narrator" in KNOWN_TOKENS

    def test_abs_narrator_folder(self):
        result = parse_naming_template(ABS_TEMPLATE, {**BASE, "Narrator": "Rosamund Pike"})
        assert result == "Robert Jordan/The Eye of the World {Rosamund Pike}/The Eye of the World"

    def test_empty_narrator_drops_braces_and_space(self):
        result = parse_naming_template(ABS_TEMPLATE, {**BASE, "Narrator": ""})
        assert result == "Robert Jordan/The Eye of the World/The Eye of the World"

    def test_double_braces_render_braced_value(self):
        assert parse_naming_template("{{Narrator}}", {"Narrator": "Rosamund Pike"}) == (
            "{Rosamund Pike}"
        )

    def test_word_separator_applies_to_narrator(self):
        result = parse_naming_template(
            "{Title}{ {Narrator}}", {**BASE, "Narrator": "Rosamund Pike"}, word_separator="."
        )
        assert result == "The.Eye.of.the.World {Rosamund.Pike}"


class TestTemplateBlocks:
    def test_nested_braces_are_one_block(self):
        assert find_template_blocks("a{ {Narrator}}b") == [(1, 14, " {Narrator}")]

    def test_unclosed_brace_stays_literal(self):
        assert parse_naming_template("{Title} {oops", BASE) == "The Eye of the World {oops"

    def test_empty_braces_stay_literal(self):
        assert parse_naming_template("{Title} {}", BASE) == "The Eye of the World {}"

    def test_existing_prefix_suffix_blocks_unchanged(self):
        template = "{Author}/{Series/}{Vol. SeriesPosition - }{Title}"
        result = parse_naming_template(
            template, {**BASE, "Series": "The Wheel of Time", "SeriesPosition": 1}
        )
        assert result == "Robert Jordan/The Wheel of Time/Vol. 1 - The Eye of the World"

    def test_trailing_separator_trimmed_per_folder(self):
        result = parse_naming_template("{Author}/{Title} - {Year}/{Title}", BASE)
        assert result == "Robert Jordan/The Eye of the World/The Eye of the World"


class TestNarratorList:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (["Kate Reading", "Michael Kramer"], ["Kate Reading", "Michael Kramer"]),
            ("Kate Reading, Michael Kramer", ["Kate Reading", "Michael Kramer"]),
            ("Kate Reading & Michael Kramer", ["Kate Reading", "Michael Kramer"]),
            (["Rosamund Pike", " Rosamund  Pike "], ["Rosamund Pike"]),
            ("", []),
            (None, []),
        ],
    )
    def test_normalizes(self, value, expected):
        assert narrator_list(value) == expected

    def test_join_defaults_to_ampersand(self):
        assert join_narrators(["Kate Reading", "Michael Kramer"]) == (
            "Kate Reading & Michael Kramer"
        )

    def test_join_with_comma(self):
        assert join_narrators(["Kate Reading", "Michael Kramer"], ",") == (
            "Kate Reading, Michael Kramer"
        )


class TestNarratorMetadata:
    def test_uses_configured_separator(self, monkeypatch):
        _config(monkeypatch, {"NARRATOR_SEPARATOR": ","})
        task = _task(narrators=["Kate Reading", "Michael Kramer"])
        assert build_metadata_dict(task)["Narrator"] == "Kate Reading, Michael Kramer"

    def test_audiobook_without_narrator_uses_placeholder(self, monkeypatch):
        _config(monkeypatch, {})
        assert build_metadata_dict(_task())["Narrator"] == "Audiobook"

    def test_ebook_without_narrator_is_empty(self, monkeypatch):
        _config(monkeypatch, {})
        assert build_metadata_dict(_task(content_type="ebook"))["Narrator"] == ""

    def test_narrators_survive_retry_round_trip(self):
        task = _task(narrators=["Kate Reading", "Michael Kramer"])
        restored = _restore_task_from_retry_payload(serialize_task_for_retry(task))
        assert restored is not None
        assert restored.narrators == ["Kate Reading", "Michael Kramer"]

    def test_old_retry_payload_without_narrators(self):
        payload = serialize_task_for_retry(_task())
        payload.pop("narrators")
        restored = _restore_task_from_retry_payload(payload)
        assert restored is not None
        assert restored.narrators is None


class TestQueueReleaseNarrators:
    @pytest.mark.parametrize(
        ("extra", "expected"),
        [
            ({"narrators": ["Kate Reading", "Michael Kramer"]}, ["Kate Reading", "Michael Kramer"]),
            ({"narrator": "Kate Reading, Michael Kramer"}, ["Kate Reading", "Michael Kramer"]),
            ({}, None),
        ],
    )
    def test_reads_narrators_from_release_extra(self, monkeypatch, extra, expected):
        from shelfmark.download import orchestrator

        captured: dict[str, DownloadTask] = {}

        def fake_add(task: DownloadTask) -> bool:
            captured["task"] = task
            return True

        monkeypatch.setattr(orchestrator.config, "get", lambda _key, default=None, **_kw: default)
        monkeypatch.setattr(orchestrator, "_source_unavailable_message", lambda _source: None)
        monkeypatch.setattr(orchestrator.book_queue, "add", fake_add)
        monkeypatch.setattr(orchestrator, "ws_manager", None)

        ok, error = orchestrator.queue_release(
            {
                "source": "prowlarr",
                "source_id": "abc",
                "title": "The Eye of the World",
                "content_type": "audiobook",
                "extra": extra,
            },
            0,
        )
        assert ok, error
        assert captured["task"].narrators == expected
