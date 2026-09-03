"""The decision, exactly as the 2016 workbooks run it.

Pure functions. No network, no model call, no I/O. Every figure here is
reproducible from the inputs and the parameters, and nothing else.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

from .params import Parameters
from .price import KES, Origin, PriceInput

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
    price: PriceInput
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
    provenance: str
    warnings: tuple[str, ...]

    def as_dict(self) -> dict:
        return asdict(self)


def value(inputs: Inputs, price: PriceInput | float, p: Parameters) -> Valuation:
    """Return the full decision set for one company at one price.

    `price` may be a bare number, taken as a KES market price, or a PriceInput
    carrying its currency, its origin and its date. The transaction cost is
    applied here and only here, on entry, so the reproduction fixtures can run
    at c = 0 and still exercise the same code path as production.

    Nothing here refuses a price for being hand-typed or private. It records
    what the price is and warns where the reader should look twice.
    """
    quote = PriceInput.coerce(price)
    warnings: list[str] = []

    if quote.currency != p.currency:
        warnings.append(
            f"price is in {quote.currency} but the discount rate is a {p.currency} rate; "
            "use a rate matching the currency of the cash flows, or state the deviation"
        )
    if not quote.origin.is_a_market_price:
        warnings.append(
            f"{quote.origin.value}: this is not a market price, so the margin of safety "
            "is doing more work than usual"
        )
    if quote.origin is Origin.MANUAL:
        warnings.append("price was entered by hand, not collected")
    if quote.is_stale:
        warnings.append(f"price is dated {quote.as_of.isoformat()} and may be stale")
    if quote.currency != KES and p.c:
        warnings.append("NSE transaction costs are being applied to a non-KES price; check they apply")

    entry = quote.amount * (1.0 + p.c)
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
        price=quote,
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
        provenance=quote.provenance(),
        warnings=tuple(warnings),
    )
