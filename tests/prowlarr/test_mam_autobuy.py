"""Tests for MyAnonamouse upload credit auto-buy."""

from __future__ import annotations

import pytest

from shelfmark.release_sources.prowlarr import mam_account, mam_autobuy
from shelfmark.release_sources.prowlarr.mam import MamAuthError

from .test_mam_account import GIB, FakeMam

BASE_SETTINGS = {
    "MAM_AUTOBUY_RATIO_ENABLED": False,
    "MAM_AUTOBUY_BUFFER_ENABLED": False,
    "MAM_AUTOBUY_BONUS_ENABLED": False,
}


def _user(uploaded_gib: float, downloaded_gib: float, seedbonus: float) -> dict:
    return {
        "username": "mouse",
        "uploaded_bytes": int(uploaded_gib * GIB),
        "downloaded_bytes": int(downloaded_gib * GIB),
        "ratio": uploaded_gib / downloaded_gib,
        "seedbonus": seedbonus,
    }


class StoreMam(FakeMam):
    """A fake MAM whose store charges 500 points per GB, and declines when short."""

    def bonus_buy(self, params):
        self.buys.append({k: v for k, v in params.items() if k != "_"})
        amount = int(params["amount"])
        points = float(self.user["seedbonus"])
        if points < amount * 500:
            return {"success": False, "error": "Not enough bonus points"}
        self.user = {**self.user, "seedbonus": points - amount * 500}
        return {"success": True, "amount": amount, "seedbonus": self.user["seedbonus"]}


@pytest.fixture
def setup(monkeypatch, tmp_path):
    values = dict(BASE_SETTINGS)
    monkeypatch.setattr(
        mam_account.config, "get", lambda key, default=None, **_kw: values.get(key, default)
    )
    monkeypatch.setattr(mam_account, "session_id", lambda: "session")
    monkeypatch.setattr(mam_autobuy, "_history_path", lambda: tmp_path / "history.json")
    from shelfmark.release_sources.prowlarr import mam_points

    monkeypatch.setattr(mam_points, "_path", lambda: tmp_path / "points.json")
    fake = StoreMam(user=_user(300, 100, 100000))
    monkeypatch.setattr(mam_account, "MamClient", fake)
    mam_account.invalidate_stats()
    yield values, fake
    mam_account.invalidate_stats()


def _amounts(fake: FakeMam) -> list[str]:
    return [buy["amount"] for buy in fake.buys]


def test_nothing_on_by_default(setup):
    _values, fake = setup
    report = mam_autobuy.run_check()
    assert report.skipped == "No auto-buy mode is on"
    assert fake.buys == []


class TestRatio:
    def test_buys_once_below_threshold(self, setup):
        values, fake = setup
        values.update(MAM_AUTOBUY_RATIO_ENABLED=True, MAM_AUTOBUY_RATIO_AMOUNT=100)
        fake.user = _user(150, 100, 100000)  # ratio 1.5

        report = mam_autobuy.run_check()

        assert _amounts(fake) == ["100"]
        assert report.purchases == [
            {"reason": "ratio", "amount_gb": 100.0, "success": True, "error": None}
        ]

    def test_nothing_at_or_above_threshold(self, setup):
        values, fake = setup
        values["MAM_AUTOBUY_RATIO_ENABLED"] = True
        fake.user = _user(200, 100, 100000)  # ratio 2.0

        mam_autobuy.run_check()

        assert fake.buys == []

    def test_respects_the_reserve(self, setup):
        values, fake = setup
        values.update(MAM_AUTOBUY_RATIO_ENABLED=True, MAM_AUTOBUY_RESERVE_POINTS=80000)
        fake.user = _user(150, 100, 100000)

        report = mam_autobuy.run_check()

        assert fake.buys == []
        assert "reserve" in report.notes[0]


class TestBuffer:
    def test_buys_when_buffer_low(self, setup):
        values, fake = setup
        values.update(MAM_AUTOBUY_BUFFER_ENABLED=True, MAM_AUTOBUY_BUFFER_THRESHOLD_GB=10)
        fake.user = _user(305, 300, 100000)  # buffer 5 GB

        mam_autobuy.run_check()

        assert _amounts(fake) == ["50"]

    def test_skipped_when_ratio_already_bought(self, setup):
        values, fake = setup
        values.update(MAM_AUTOBUY_RATIO_ENABLED=True, MAM_AUTOBUY_BUFFER_ENABLED=True)
        fake.user = _user(105, 100, 100000)  # ratio 1.05, buffer 5 GB

        mam_autobuy.run_check()

        assert _amounts(fake) == ["50"]


class TestBonus:
    def test_spends_down_to_the_threshold(self, setup):
        values, fake = setup
        values.update(MAM_AUTOBUY_BONUS_ENABLED=True, MAM_AUTOBUY_BONUS_THRESHOLD=50000)
        fake.user = _user(300, 100, 110000)

        mam_autobuy.run_check()

        # 110k -> 85k -> 60k -> 35k: three 50 GB buys, then below the threshold.
        assert _amounts(fake) == ["50", "50", "50"]

    def test_stops_when_points_do_not_go_down(self, setup):
        values, fake = setup
        values.update(MAM_AUTOBUY_BONUS_ENABLED=True, MAM_AUTOBUY_BONUS_THRESHOLD=0)
        fake.user = _user(300, 100, 100000)
        fake.bonus_buy = lambda params: (
            fake.buys.append(params) or {"success": True, "amount": 50, "seedbonus": 100000}
        )

        report = mam_autobuy.run_check()

        assert len(fake.buys) == 1
        assert "did not go down" in report.notes[0]

    def test_capped_per_check(self, setup):
        values, fake = setup
        values.update(MAM_AUTOBUY_BONUS_ENABLED=True, MAM_AUTOBUY_BONUS_THRESHOLD=0)
        fake.user = _user(300, 100, 10_000_000)

        report = mam_autobuy.run_check()

        assert len(fake.buys) == 20
        assert "Stopped after 20" in report.notes[-1]

    def test_stops_on_a_declined_purchase(self, setup):
        values, fake = setup
        values.update(
            MAM_AUTOBUY_BONUS_ENABLED=True,
            MAM_AUTOBUY_BONUS_THRESHOLD=0,
            MAM_AUTOBUY_BONUS_AMOUNT=100,
        )
        fake.user = _user(300, 100, 60000)
        replies = iter([{"success": True, "amount": 100, "seedbonus": 55000}])

        def store(params):
            fake.buys.append(params)
            return next(replies, {"success": False, "error": "Store closed"})

        fake.bonus_buy = store

        report = mam_autobuy.run_check()

        assert len(fake.buys) == 2
        assert report.purchases[-1]["success"] is False


class TestHistoryAndSettings:
    def test_purchases_are_recorded_newest_first(self, setup):
        values, fake = setup
        values.update(MAM_AUTOBUY_BONUS_ENABLED=True, MAM_AUTOBUY_BONUS_THRESHOLD=70000)
        fake.user = _user(300, 100, 100000)

        mam_autobuy.buy(50, reason="manual")  # 100k -> 75k, still above the threshold
        mam_autobuy.run_check()

        history = mam_autobuy.load_history()
        assert [entry["reason"] for entry in history] == ["bonus", "manual"]
        assert history[0]["amount_gb"] == 50

    def test_amounts_round_down_to_store_steps(self, setup):
        values, _fake = setup
        values.update(MAM_AUTOBUY_RATIO_AMOUNT=120, MAM_AUTOBUY_BUFFER_AMOUNT=10)
        settings = mam_autobuy.load_settings()
        assert (settings.ratio_amount, settings.buffer_amount) == (100, 50)

    def test_unreachable_mam_is_reported(self, setup):
        values, fake = setup
        values["MAM_AUTOBUY_RATIO_ENABLED"] = True
        fake.user = MamAuthError("rejected (403)")

        report = mam_autobuy.run_check()

        assert report.skipped == "rejected (403)"
        assert fake.buys == []

    def test_warning_ratio_follows_the_ratio_threshold(self, setup):
        values, _fake = setup
        values["MAM_AUTOBUY_RATIO_THRESHOLD"] = 1.5
        assert mam_account.warning_ratio() == 1.5
