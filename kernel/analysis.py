"""The rest of the mandatory output: the verdict, the score, the multiples, the hurdles.

`brian` §4 (vii) and (viii). The decision sheet answers one question - is the
price below what the earnings are worth. This answers the rest of them, and
never silently: every figure carries the parameters that produced it.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

BUY_VERDICT, HOLD, SELL = "BUY", "HOLD", "SELL"

#: Above this margin the price is clearly below value; below zero it is clearly
#: above. Between the two the answer is HOLD, which the workbook had no room
#: for: it printed BUY or "smile and walk away" and nothing in between.
DEFAULT_HOLD_FLOOR = 0.15


def verdict(margin: float, hold_floor: float = DEFAULT_HOLD_FLOOR) -> str:
    """Three states, not two. A thin margin is not a buy and is not a sell."""
    if margin >= hold_floor:
        return BUY_VERDICT
    if margin >= 0.0:
        return HOLD
    return SELL


@dataclass(frozen=True)
class Multiples:
    market_cap: float
    enterprise_value: float
    ebitda: float
    ev_ebitda: float | None
    price_to_book: float | None
    ebitda_note: str

    def as_dict(self) -> dict:
        return asdict(self)


def multiples(
    *, entry_price: float, shares: float, cash: float, debt: float,
    total_income: float, total_expenses: float, net_capital: float,
) -> Multiples:
    """Enterprise value over EBITDA, with the proxy stated rather than hidden.

    A published EBITDA is not in the eleven figures the decision sheet takes, so
    income less expenses stands in for it. That is EBITA in substance, and the
    difference matters, so it is printed rather than assumed away.
    """
    market_cap = entry_price * shares
    ev = market_cap + debt - cash
    ebitda = total_income - total_expenses
    return Multiples(
        market_cap=market_cap,
        enterprise_value=ev,
        ebitda=ebitda,
        ev_ebitda=ev / ebitda if ebitda > 0 else None,
        price_to_book=(market_cap / net_capital) if net_capital > 0 else None,
        ebitda_note=(
            "EBITDA is total income less total expenses: EBITA in substance, "
            "because depreciation is not among the figures the decision sheet takes."
        ),
    )


def irr(entry: float, exit_value: float, years: float, income_per_year: float = 0.0) -> float | None:
    """Internal rate of return on one entry, a stream of dividends, and one exit.

    Bisection rather than Newton: it cannot diverge, and a valuation tool that
    silently fails to converge is worse than one that says it could not.
    """
    if entry <= 0 or years <= 0:
        return None

    def npv(rate: float) -> float:
        total = -entry
        for year in range(1, int(years) + 1):
            total += income_per_year / (1.0 + rate) ** year
        total += exit_value / (1.0 + rate) ** years
        return total

    low, high = -0.9999, 10.0
    if npv(low) < 0 or npv(high) > 0:
        return None
    for _ in range(200):
        mid = (low + high) / 2.0
        if npv(mid) > 0:
            low = mid
        else:
            high = mid
    return (low + high) / 2.0


@dataclass(frozen=True)
class Hurdles:
    gross_yield: float
    net_yield: float
    withholding_rate: float
    inflation_rate: float
    beats_inflation: bool
    real_yield: float
    entry_in_usd: float | None
    usd_rate: float | None
    entry_in_btc: float | None
    btc_usd: float | None

    def as_dict(self) -> dict:
        return asdict(self)


def hurdles(
    *, entry_price: float, dividend_per_share: float, withholding: float,
    inflation: float, usd_rate: float | None = None, btc_usd: float | None = None,
) -> Hurdles:
    """The two hurdles, printed even when they embarrass the verdict.

    Inflation is a hurdle: a yield below it loses money in real terms. The
    currency line is a check, not a hurdle - it says whether a shilling gain is
    a real gain, and it never vetoes the verdict.
    """
    gross = dividend_per_share / entry_price if entry_price > 0 else 0.0
    net = gross * (1.0 - withholding)
    in_usd = entry_price / usd_rate if usd_rate else None
    return Hurdles(
        gross_yield=gross,
        net_yield=net,
        withholding_rate=withholding,
        inflation_rate=inflation,
        beats_inflation=net > inflation,
        real_yield=net - inflation,
        entry_in_usd=in_usd,
        usd_rate=usd_rate,
        entry_in_btc=(in_usd / btc_usd) if (in_usd and btc_usd) else None,
        btc_usd=btc_usd,
    )


@dataclass(frozen=True)
class EnergyScore:
    valuation: int
    yield_: int
    growth_quality: int
    total: int
    band: str
    reasons: tuple[str, ...]

    def as_dict(self) -> dict:
        d = asdict(self)
        d["yield"] = d.pop("yield_")
        return d


def energy_score(
    *, margin: float, net_yield: float, inflation: float,
    surplus: float, stressed_surplus: float, liquidity_ratio: float,
) -> EnergyScore:
    """`brian` §4 (vii). Zero to seven: valuation, yield, growth quality.

    Economic energy against entropy. Each component says why it scored what it
    scored, because a score nobody can argue with is a score nobody trusts.
    """
    reasons: list[str] = []

    if margin >= 0.40:
        v, why = 3, "a wide margin, over 40%"
    elif margin >= DEFAULT_HOLD_FLOOR:
        v, why = 2, "a real margin, over 15%"
    elif margin >= 0:
        v, why = 1, "positive but thin"
    else:
        v, why = 0, "the market charges more than the earnings are worth"
    reasons.append(f"Valuation {v}/3: {why}.")

    if net_yield >= inflation * 1.5:
        y, why = 2, "comfortably ahead of inflation"
    elif net_yield > inflation:
        y, why = 1, "ahead of inflation, narrowly"
    else:
        y, why = 0, "below inflation, so the income loses money in real terms"
    reasons.append(f"Yield {y}/2: {why}.")

    g = 0
    if stressed_surplus > 0:
        g += 1
        reasons.append("Growth 1: survives a 10% squeeze on both sides.")
    elif surplus > 0:
        reasons.append("Growth 0: profitable, but a 10% squeeze erases it.")
    else:
        reasons.append("Growth 0: obligations already exceed income.")
    if liquidity_ratio >= 1.5:
        g += 1
        reasons.append("Growth +1: liquidity ratio at or above 1.5.")

    total = v + y + g
    band = "High energy" if total >= 5 else "Mixed" if total >= 3 else "High entropy"
    return EnergyScore(valuation=v, yield_=y, growth_quality=g, total=total,
                       band=band, reasons=tuple(reasons))
