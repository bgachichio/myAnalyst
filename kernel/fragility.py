"""The second sheet: liquidity, surplus, and the stress that decides fragility.

The line-item map differs by sector. UNGA maps current assets against current
liabilities. Liberty maps insurance and investment assets against insurance
liabilities, and cash and government securities against those same liabilities.
Applying one map to both is the error that breaks a generic tool.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

from .params import Parameters, SectorProfile
from .valuation import Inputs

ANTIFRAGILE = "ANTIFRAGILE"
FRAGILE = "FRAGILE"

# The workbook's own status strings. Kept deliberately.
OK = "OK"
RUN = "RUN LIKE HELL"
HMM = "HMM… WHY IS THIS?"

#: Where the Focus Model ratio, EBITA over net working capital, means anything.
#: A bank or an insurer has no working capital in this sense, so the ratio is
#: suppressed with a reason rather than printed as a number that lies.
FOCUS_MODEL_SECTORS = frozenset({SectorProfile.INDUSTRIAL, SectorProfile.PROPERTY, SectorProfile.TELCO})
FOCUS_MODEL_FLOOR = 0.45


@dataclass(frozen=True)
class Fragility:
    sector_profile: SectorProfile
    working_capital: float
    liquidity_ratio: float
    liquidity_status: str
    excess_cash: float
    excess_cash_status: str
    surplus: float
    surplus_status: str
    stressed_surplus: float
    verdict: str
    focus_model_ratio: float | None
    focus_model_note: str

    def as_dict(self) -> dict:
        d = asdict(self)
        d["sector_profile"] = self.sector_profile.value
        return d


def _focus_model(inputs: Inputs, profile: SectorProfile, working_capital: float) -> tuple[float | None, str]:
    if profile not in FOCUS_MODEL_SECTORS:
        return None, f"Suppressed: a {profile.value} has no net working capital in this sense."
    if working_capital <= 0:
        return None, "Suppressed: net working capital is zero or negative, so the ratio is undefined."
    ebita = inputs.total_income - inputs.total_expenses
    ratio = ebita / working_capital
    verdict = "clears" if ratio >= FOCUS_MODEL_FLOOR else "below"
    return ratio, f"EBITA over net working capital {verdict} the {FOCUS_MODEL_FLOOR:.0%} floor."


def assess(inputs: Inputs, profile: SectorProfile, p: Parameters) -> Fragility:
    """Run the fragility sheet for one company under one stress."""
    working_capital = inputs.current_assets - inputs.current_liabilities
    liquidity_ratio = inputs.current_assets / inputs.current_liabilities
    excess_cash = (inputs.cash_and_securities - inputs.current_liabilities) / inputs.current_liabilities

    obligations = inputs.total_expenses + inputs.income_tax_expense
    surplus = (inputs.total_income - obligations) / obligations

    stressed_revenue = (1.0 - p.stress) * inputs.total_income
    stressed_obligations = (1.0 + p.stress) * obligations
    stressed_surplus = (stressed_revenue - stressed_obligations) / stressed_obligations

    ratio, note = _focus_model(inputs, profile, working_capital)

    return Fragility(
        sector_profile=profile,
        working_capital=working_capital,
        liquidity_ratio=liquidity_ratio,
        liquidity_status=OK if liquidity_ratio > 1.0 else RUN,
        excess_cash=excess_cash,
        excess_cash_status=OK if excess_cash > 0 else HMM,
        surplus=surplus,
        surplus_status=OK if surplus > 0 else RUN,
        stressed_surplus=stressed_surplus,
        verdict=ANTIFRAGILE if stressed_surplus > 0 else FRAGILE,
        focus_model_ratio=ratio,
        focus_model_note=note,
    )
