"""What the collector is meant to hold, why, and what may lawfully be held.

One row per series. A series that cannot name the decision it changes does not
enter, and a series whose licence is unverified is declared here rather than
quietly collected.

`retention_days` is the rolling window of full-resolution history. Everything
older is kept at month-end resolution for ever, which costs almost nothing.
`None` means keep every observation: true only for series that arrive a handful
of times a year.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Cadence(str, Enum):
    DAILY = "daily"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"
    PER_AUCTION = "per-auction"


class Licence(str, Enum):
    #: Confirmed free to fetch and to hold for personal use.
    OPEN = "open"
    #: Believed free, not yet verified from a machine that can reach it.
    UNVERIFIED = "unverified"
    #: Known or strongly suspected to be licensed. No adapter until cleared.
    RESTRICTED = "restricted"


@dataclass(frozen=True)
class Series:
    series_id: str
    label: str
    cadence: Cadence
    licence: Licence
    source: str
    decision: str                 # the decision this series changes. No decision, no series.
    retention_days: int | None = 400
    unit: str = ""

    @property
    def collectable(self) -> bool:
        """A restricted series is registered but never fetched."""
        return self.licence is not Licence.RESTRICTED


#: 400 trading days is about eighteen months: a 52-week range and a one-year
#: return with headroom. Nothing in the mandatory output needs more at full
#: resolution.
WINDOW = 400

REGISTRY: tuple[Series, ...] = (
    # ---- the discount rate -------------------------------------------------
    Series(
        "gok.bond.yield", "GoK bond yield, benchmark tenor", Cadence.PER_AUCTION,
        Licence.UNVERIFIED, "centralbank.go.ke/bills-bonds/treasury-bonds/",
        "Sets r, the discount rate in the kernel. Carries the tenor and auction date it came from.",
        retention_days=None, unit="% p.a.",
    ),
    Series(
        "cbk.cbr", "Central Bank Rate", Cadence.PER_AUCTION,
        Licence.UNVERIFIED, "centralbank.go.ke/press/",
        "Borrowing cost floor when leverage is modelled before entry.",
        retention_days=None, unit="% p.a.",
    ),
    Series(
        "ke.inflation", "Kenya inflation, year on year", Cadence.MONTHLY,
        Licence.UNVERIFIED, "centralbank.go.ke",
        "The inflation hurdle the net dividend yield is measured against.",
        retention_days=None, unit="%",
    ),

    # ---- NSE ---------------------------------------------------------------
    Series(
        "nse.equity.close", "NSE end-of-day closes", Cadence.DAILY,
        Licence.UNVERIFIED, "nse.co.ke/dataservices/market-statistics/",
        "The price in every valuation. Held per counter in daily_prices, not here.",
        retention_days=WINDOW, unit="KES",
    ),
    Series(
        "nse.nasi", "NASI, all-share index", Cadence.DAILY,
        Licence.UNVERIFIED, "nse.co.ke/dataservices/market-statistics/",
        "Market context for a single-counter verdict: is this counter moving, or is the market?",
        retention_days=WINDOW, unit="index",
    ),
    Series(
        "nse.nse25", "NSE 25 Share Index", Cadence.DAILY,
        Licence.UNVERIFIED, "nse.co.ke/dataservices/market-statistics/",
        "Liquid large-cap benchmark. The relative-performance line in the memo.",
        retention_days=WINDOW, unit="index",
    ),
    Series(
        "nse.banking", "NSE Banking Sector Index", Cadence.DAILY,
        Licence.UNVERIFIED, "nse.co.ke/dataservices/market-statistics/",
        "Sector benchmark for bank profiles, where the Focus Model ratio is suppressed.",
        retention_days=WINDOW, unit="index",
    ),

    # ---- macro -------------------------------------------------------------
    Series(
        "ke.gdp.growth", "Kenya real GDP growth", Cadence.ANNUAL,
        Licence.UNVERIFIED, "World Bank indicator API, NY.GDP.MKTP.KD.ZG",
        "Sanity check on g, the long-run growth assumption. g is Brian's estimate, not this figure.",
        retention_days=None, unit="%",
    ),

    # ---- the hurdle --------------------------------------------------------
    Series(
        "btc.usd", "Bitcoin, US dollars", Cadence.DAILY,
        Licence.UNVERIFIED, "to be chosen: a free, documented, terms-clean endpoint",
        "The Bitcoin hurdle. Mandatory in every analysis under brian §4, and absent from the request.",
        retention_days=WINDOW, unit="USD",
    ),

    # ---- registered, deliberately not collected ----------------------------
    Series(
        "us.djia", "Dow Jones Industrial Average", Cadence.DAILY,
        Licence.RESTRICTED, "S&P Dow Jones Indices; index levels are licensed IP",
        "No decision in the mandatory output turns on it. Registered so the question is not asked twice.",
        retention_days=WINDOW, unit="index",
    ),
    Series(
        "us.nasdaq", "Nasdaq Composite", Cadence.DAILY,
        Licence.RESTRICTED, "Nasdaq; redistribution terms unverified",
        "As above. If a global risk gauge is wanted, brian §5 already uses M2, stablecoins and USD/JPY.",
        retention_days=WINDOW, unit="index",
    ),
)

BY_ID: dict[str, Series] = {s.series_id: s for s in REGISTRY}


def collectable() -> tuple[Series, ...]:
    return tuple(s for s in REGISTRY if s.collectable)


def storage_estimate_bytes(years: int = 20) -> int:
    """Rough ceiling for the whole store, so the retention rule can be argued about.

    Assumes ~65 NSE counters, ~250 trading days a year, and 48 bytes a row.
    """
    row, trading_days, counters = 48, 250, 65
    equities = counters * (WINDOW + 12 * years) * row
    daily_series = sum(1 for s in collectable() if s.cadence is Cadence.DAILY and s.series_id != "nse.equity.close")
    indices = daily_series * (WINDOW + 12 * years) * row
    slow = sum(1 for s in collectable() if s.cadence is not Cadence.DAILY) * 12 * years * row
    return equities + indices + slow
