"""The gate. Nothing else in this repository is built until these pass.

The fixtures are the 2016 UNGA and Liberty workbooks. Where the kernel and the
workbook disagree, the workbook is right.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from kernel import Inputs, Parameters, SectorProfile, assess, value

FIXTURES = json.loads((Path(__file__).resolve().parents[1] / "fixtures" / "kernel-fixtures.json").read_text())
CASES = FIXTURES["cases"]
IDS = [c["ticker"] for c in CASES]


def _params(**over) -> Parameters:
    p = dict(FIXTURES["params"])
    p.update(over)
    return Parameters(**p)


def _run(case, **over):
    inputs = Inputs(**case["inputs"])
    p = _params(**over)
    v = value(inputs, case["price"], p)
    f = assess(inputs, SectorProfile(case["sector_profile"]), p)
    return v, f


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_reproduces_the_workbook(case):
    """Every headline figure, to the cent."""
    v, f = _run(case)
    e = case["expect"]

    assert round(v.my_future_eps, 2) == e["my_future_eps"]
    assert round(v.my_valuation, 2) == e["my_valuation"]
    assert round(v.pv_dividends_ps, 2) == e["pv_dividends_ps"]
    assert round(v.cash_ps, 2) == e["cash_ps"]
    assert round(v.market_price_fe, 2) == e["market_price_fe"]
    assert v.decision == e["decision"]
    assert round(v.margin, 4) == e["margin"]
    assert round(v.eps, 2) == e["eps"]
    assert round(v.trailing_pe, 2) == e["trailing_pe"]
    assert round(v.nav_ps, 2) == e["nav_ps"]
    assert v.cigar_butt is e["cigar_butt"]

    assert round(f.liquidity_ratio, 2) == e["liquidity_ratio"]
    assert round(f.excess_cash, 4) == e["excess_cash"]
    assert round(f.surplus, 4) == e["surplus"]
    assert round(f.stressed_surplus, 4) == e["stressed_surplus"]
    assert f.verdict == e["fragility"]


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_one_shilling_moves_the_answer(case):
    """A test that still passes when an input is wrong is not a test."""
    base, _ = _run(case)
    nudged = dict(case)
    nudged["price"] = case["price"] + 1.0
    moved, _ = _run(nudged)
    assert not math.isclose(moved.market_price_fe, base.market_price_fe)
    assert math.isclose(moved.market_price_fe - base.market_price_fe, 1.0, abs_tol=1e-9)


def test_the_two_sectors_take_different_paths():
    """The Focus Model ratio is computed for the miller and suppressed for the insurer."""
    unga = next(c for c in CASES if c["sector_profile"] == "industrial")
    lbty = next(c for c in CASES if c["sector_profile"] == "insurer")

    _, f_unga = _run(unga)
    _, f_lbty = _run(lbty)

    assert f_unga.focus_model_ratio is not None
    assert f_lbty.focus_model_ratio is None
    assert "insurer" in f_lbty.focus_model_note


def test_transaction_cost_loads_the_entry_and_never_the_exit():
    case = CASES[0]
    free, _ = _run(case, c=0.0)
    loaded, _ = _run(case, c=0.026)
    assert math.isclose(loaded.entry_price, case["price"] * 1.026)
    assert loaded.market_price_fe > free.market_price_fe
    assert math.isclose(loaded.my_valuation, free.my_valuation), "cost must not touch the valuation side"


def test_withholding_defaults_to_the_resident_rate():
    case = CASES[0]
    v, _ = _run(case)
    assert math.isclose(v.net_dividend_ps, case["inputs"]["dividend_per_share_proposed"] * 0.95)
    v15, _ = _run(case, w=0.15)
    assert math.isclose(v15.net_dividend_ps, case["inputs"]["dividend_per_share_proposed"] * 0.85)


@pytest.mark.parametrize(
    "bad",
    [{"r": 0.0}, {"k": 1.0}, {"c": 0.11}, {"w": 1.0}, {"n": 0}],
    ids=["zero rate", "no margin left", "cost above the slider", "all withheld", "no horizon"],
)
def test_parameters_refuse_nonsense(bad):
    with pytest.raises(ValueError):
        _params(**bad)
