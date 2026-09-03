"""The decision, exactly as the 2016 workbooks run it.

Pure functions. No network, no model call, no I/O. Every figure here is
reproducible from the inputs and the parameters, and nothing else.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

from .params import Parameters

BUY = "BUY"
WALK = "SMILE AND WALK AWAY"


def fv_annuity(rate: float, nper: int, payment: float) -> float:
    """Excel FV(rate, nper, -payment): future value of a level annuity."""
    return payment * (((1.0 + rate) ** nper - 1.0) / rate)


def pv_lump(rate: float, nper: int, future_value: float) -> float:
    """Excel PV(rate, nper, 0, -future_value): present value of a single sum."""
    return future_value / ((1.0 + rate) ** nper)


@dataclass(frozen=True)
class Inputs:
    net_profit_from_operations: float
    dividend_per_share_proposed: float
    cash_and_bank: float
    shares_issued: float
    current_assets: float
    current_liabilities: float
    cash_and_securities: float
    non_current_assets: float
    non_current_liabilities: float
    total_income: float
    total_expenses: float
    income_tax_expense: float

    def __post_init__(self) -> None:
        if self.shares_issued <= 0:
            raise ValueError("shares issued must be positive")


@dataclass(frozen=True)
class Valuation:
    entry_price: float
    my_future_eps: float
    my_valuation: float
    pv_dividends_ps: float
    cash_ps: float
    market_price_fe: float
    decision: str
    margin: float
    eps: float
    trailing_pe: float
    net_capital: float
    nav_ps: float
    cigar_butt: bool
    my_nav_value_ps: float
    net_dividend_ps: float

    def as_dict(self) -> dict:
        return asdict(self)


def value(inputs: Inputs, price: float, p: Parameters) -> Valuation:
    """Return the full decision set for one company at one price.

    `price` is the screen price. The transaction cost is applied here and only
    here, on entry, so the reproduction fixtures can run at c = 0 and still
    exercise the same code path as production.
    """
    if price <= 0:
        raise ValueError("price must be positive")

    entry = price * (1.0 + p.c)
    shares = inputs.shares_issued

    pv_earnings = pv_lump(p.r, p.n, fv_annuity(p.g, p.n, inputs.net_profit_from_operations))
    pv_dividends_ps = pv_lump(p.r, p.n, fv_annuity(p.g, p.n, inputs.dividend_per_share_proposed))
    cash_ps = inputs.cash_and_bank / shares

    my_future_eps = pv_earnings / shares
    my_valuation = (1.0 - p.k) * my_future_eps
    market_price_fe = entry - pv_dividends_ps - cash_ps

    eps = inputs.net_profit_from_operations / shares
    net_capital = (inputs.current_assets - inputs.current_liabilities) + (
        inputs.non_current_assets - inputs.non_current_liabilities
    )
    nav_ps = net_capital / shares

    return Valuation(
        entry_price=entry,
        my_future_eps=my_future_eps,
        my_valuation=my_valuation,
        pv_dividends_ps=pv_dividends_ps,
        cash_ps=cash_ps,
        market_price_fe=market_price_fe,
        decision=BUY if my_valuation >= market_price_fe else WALK,
        margin=(my_valuation - market_price_fe) / my_valuation if my_valuation else float("nan"),
        eps=eps,
        trailing_pe=entry / eps if eps else float("nan"),
        net_capital=net_capital,
        nav_ps=nav_ps,
        cigar_butt=nav_ps >= entry,
        my_nav_value_ps=(1.0 - p.k) * nav_ps,
        net_dividend_ps=inputs.dividend_per_share_proposed * (1.0 - p.w),
    )
