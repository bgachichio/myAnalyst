"""Parameters for the valuation kernel.

Every one is live or editable. None is a constant carried over from 2017.
Any output that quotes a number must also quote the parameter set that produced it.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from enum import Enum


class SectorProfile(str, Enum):
    """Selects the line-item map and the ratios that mean anything.

    The two source workbooks share a decision sheet and use different fragility
    sheets: a miller has working capital, an insurer does not, in that sense.
    """

    INDUSTRIAL = "industrial"
    INSURER = "insurer"
    BANK = "bank"
    PROPERTY = "property"
    TELCO = "telco"


@dataclass(frozen=True)
class Parameters:
    r: float          # discount rate, the GoK bond yield for the tenor actually used
    g: float = 0.04   # long-run growth
    k: float = 0.35   # margin of safety
    n: int = 15       # horizon, years
    c: float = 0.026  # NSE transaction cost, entry only, nothing on exit
    w: float = 0.05   # dividend withholding: resident holdings under 12.5%
    stress: float = 0.10
    r_tenor_years: int | None = None   # the tenor the rate actually came from
    r_auction_date: str | None = None  # and the auction that set it

    def __post_init__(self) -> None:
        if self.r <= 0:
            raise ValueError("discount rate must be positive")
        if self.n <= 0:
            raise ValueError("horizon must be at least one year")
        if not 0.0 <= self.k < 1.0:
            raise ValueError("margin of safety must be in [0, 1)")
        if not 0.0 <= self.c <= 0.10:
            raise ValueError("transaction cost slider runs 0% to 10%")
        if not 0.0 <= self.w < 1.0:
            raise ValueError("withholding rate must be in [0, 1)")

    def provenance(self) -> dict:
        """What the memo prints beneath every number it quotes."""
        return asdict(self)
