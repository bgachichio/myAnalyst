"""The rest of the memo, tested against the same fixture file as the browser.

Every figure here is computed twice, once in Python and once in TypeScript. The
fixture is the referee.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from kernel import Inputs, Parameters, SectorProfile, assess, value
from kernel.analysis import BUY_VERDICT as BUY, HOLD, SELL, energy_score, hurdles, irr, multiples, verdict

FIXTURES = json.loads((Path(__file__).resolve().parents[1] / "fixtures" / "kernel-fixtures.json").read_text())
CASES = FIXTURES["cases"]
IDS = [c["ticker"] for c in CASES]
MACRO = FIXTURES["macro"]
PARAMS = Parameters(**FIXTURES["params"])


def _memo(case):
    raw = case["inputs"]
    inputs = Inputs(**raw)
    v = value(inputs, case["price"], PARAMS)
    f = assess(inputs, SectorProfile(case["sector_profile"]), PARAMS)
    m = multiples(
        entry_price=v.entry_price, shares=raw["shares_issued"],
        cash=raw["cash_and_securities"],
        debt=raw["current_liabilities"] + raw["non_current_liabilities"],
        total_income=raw["total_income"], total_expenses=raw["total_expenses"],
        net_capital=v.net_capital,
    )
    h = hurdles(
        entry_price=v.entry_price, dividend_per_share=raw["dividend_per_share_proposed"],
        withholding=PARAMS.w, inflation=MACRO["inflation"],
        usd_rate=MACRO["usd_kes"], btc_usd=MACRO["btc_usd"],
    )
    s = energy_score(
        margin=v.margin, net_yield=h.net_yield, inflation=MACRO["inflation"],
        surplus=f.surplus, stressed_surplus=f.stressed_surplus,
        liquidity_ratio=f.liquidity_ratio,
    )
    return v, f, m, h, s


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_the_memo_figures_hold(case):
    v, _f, m, h, s = _memo(case)
    e = case["expect"]["analysis"]

    assert verdict(v.margin) == e["verdict"]
    assert round(m.market_cap, 2) == e["market_cap"]
    assert round(m.enterprise_value, 2) == e["enterprise_value"]
    assert round(m.ebitda, 2) == e["ebitda"]
    assert round(m.ev_ebitda, 4) == e["ev_ebitda"]
    assert round(m.price_to_book, 4) == e["price_to_book"]

    assert round(h.gross_yield, 4) == e["gross_yield"]
    assert round(h.net_yield, 4) == e["net_yield"]
    assert h.beats_inflation is e["beats_inflation"]
    assert round(h.real_yield, 4) == e["real_yield"]
    assert round(h.entry_in_usd, 4) == e["entry_in_usd"]

    assert (s.valuation, s.yield_, s.growth_quality, s.total, s.band) == (
        e["energy"]["valuation"], e["energy"]["yield"],
        e["energy"]["growth_quality"], e["energy"]["total"], e["energy"]["band"],
    )
    assert len(s.reasons) >= 3, "a score with no reasons is a number nobody can argue with"


@pytest.mark.parametrize("row", FIXTURES["analysis_cases"]["verdicts"],
                         ids=lambda r: f"margin {r['margin']}")
def test_hold_is_a_real_third_state(row):
    assert verdict(row["margin"]) == row["expect"]


def test_the_hold_floor_moves_the_verdict():
    """The floor is a parameter, not a constant hidden in the code."""
    assert verdict(0.10) == HOLD
    assert verdict(0.10, hold_floor=0.05) == BUY
    assert verdict(-0.001) == SELL


@pytest.mark.parametrize("row", FIXTURES["analysis_cases"]["irr"],
                         ids=lambda r: f"{r['entry']}->{r['exit']} over {r['years']}y")
def test_irr_solves_or_says_it_cannot(row):
    got = irr(row["entry"], row["exit"], row["years"], row["income"])
    if row["expect"] is None:
        assert got is None, "a total loss has no finite rate; None beats a wrong number"
    else:
        assert round(got, 4) == row["expect"]


def test_irr_actually_zeroes_the_npv():
    """A rate that does not discount the cash flows back to the entry is not an IRR."""
    entry, exit_value, years, income = 28.0, 56.0, 5, 1.0
    rate = irr(entry, exit_value, years, income)
    npv = -entry + sum(income / (1 + rate) ** y for y in range(1, years + 1))
    npv += exit_value / (1 + rate) ** years
    assert math.isclose(npv, 0.0, abs_tol=1e-6)


def test_ebitda_is_named_as_a_proxy():
    case = CASES[0]
    _v, _f, m, _h, _s = _memo(case)
    assert "EBITA in substance" in m.ebitda_note


def test_a_loss_making_company_gets_no_multiple():
    m = multiples(entry_price=10.0, shares=100.0, cash=0.0, debt=0.0,
                  total_income=100.0, total_expenses=140.0, net_capital=-50.0)
    assert m.ev_ebitda is None, "a negative EBITDA multiple is noise dressed as a number"
    assert m.price_to_book is None


def test_the_currency_check_never_vetoes():
    """Bitcoin restates the entry; it does not change the verdict."""
    with_btc = hurdles(entry_price=28.0, dividend_per_share=1.0, withholding=0.05,
                       inflation=0.079, usd_rate=103.4, btc_usd=2200.0)
    without = hurdles(entry_price=28.0, dividend_per_share=1.0, withholding=0.05,
                      inflation=0.079)
    assert with_btc.net_yield == without.net_yield
    assert with_btc.beats_inflation == without.beats_inflation
    assert without.entry_in_btc is None and without.entry_in_usd is None


def test_the_score_bands_span_the_range():
    high = energy_score(margin=0.5, net_yield=0.15, inflation=0.079, surplus=0.2,
                        stressed_surplus=0.05, liquidity_ratio=2.0)
    low = energy_score(margin=-0.2, net_yield=0.0, inflation=0.079, surplus=-0.1,
                       stressed_surplus=-0.3, liquidity_ratio=0.4)
    assert high.total == 7 and high.band == "High energy"
    assert low.total == 0 and low.band == "High entropy"
