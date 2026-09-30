"""Tests for the MyAnonamouse bonus points rate estimate."""

from __future__ import annotations

import pytest

from shelfmark.release_sources.prowlarr import mam_points

H = 3600.0
NOW = 1_000_000.0


def _series(*points: float) -> list[tuple[float, float]]:
    """Hourly readings ending at NOW."""
    start = NOW - H * (len(points) - 1)
    return [(start + i * H, p) for i, p in enumerate(points)]


def _rate(points, spending=()):
    return mam_points.estimate_rate(points, now=NOW, spending=list(spending))


def test_steady_earnings():
    rate = _rate(_series(1000, 1040, 1080, 1120))
    assert rate == {"per_hour": pytest.approx(40), "hours": pytest.approx(3)}


def test_shelfmark_purchases_are_added_back():
    # +40, then 25,000 spent by Shelfmark on 50 GB while earning 40, then +40
    points = _series(30000, 30040, 5080, 5120)
    purchase = [(points[1][0] + 600, 25000.0)]
    rate = _rate(points, purchase)
    assert rate == {"per_hour": pytest.approx(40), "hours": pytest.approx(3)}


def test_spending_elsewhere_is_left_out():
    # +40, 10,000 spent on MAM's site (unknown to Shelfmark), +40
    rate = _rate(_series(30000, 30040, 20080, 20120))
    assert rate == {"per_hour": pytest.approx(40), "hours": pytest.approx(2)}


def test_periods_at_the_cap_are_left_out():
    rate = _rate(_series(99900, 99940, 99980, 99999, 99999))
    assert rate == {"per_hour": pytest.approx(40), "hours": pytest.approx(2)}


def test_needs_two_hours():
    assert _rate(_series(1000, 1040)) is None
    assert _rate([]) is None


def test_only_the_last_day_counts():
    old = [(NOW - 30 * H, 0.0), (NOW - 29 * H, 5000.0)]
    rate = _rate(old + _series(1000, 1010, 1020))
    assert rate is not None and rate["per_hour"] == pytest.approx(10)


def test_samples_are_recorded_and_thinned(tmp_path, monkeypatch):
    monkeypatch.setattr(mam_points, "_path", lambda: tmp_path / "points.json")
    mam_points.record_sample(100, at=NOW)
    mam_points.record_sample(110, at=NOW + 60)  # too soon, skipped
    mam_points.record_sample(150, at=NOW + H)
    mam_points.record_sample(200, at=NOW + 50 * H)  # the first two are now past 48 h

    assert mam_points.load_samples() == [(NOW + 50 * H, 200.0)]
