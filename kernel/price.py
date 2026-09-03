"""Where a price came from, and in what currency.

The NSE feed is one source among several. A private deal has no quoted price, a
foreign listing is not in shillings, and the feed itself will fail on some
Tuesday. Each of those is a legitimate way to reach a number, and each has to
say so on the face of the memo: a hand-typed price and a fetched one must never
look alike after the fact.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from enum import Enum


class Origin(str, Enum):
    """How the price was arrived at. Printed on every memo."""

    NSE_FEED = "nse-feed"                # collected automatically, dated by the exchange
    MANUAL = "manual"                    # typed in, usually because the feed failed
    PRIVATE_DEAL = "private-deal"        # an offer or a round price, not a market price
    FOREIGN_LISTED = "foreign-listed"    # quoted on another exchange
    FOREIGN_PRIVATE = "foreign-private"  # unquoted, outside Kenya

    @property
    def is_a_market_price(self) -> bool:
        """A market price is one somebody could actually have transacted at."""
        return self in (Origin.NSE_FEED, Origin.MANUAL, Origin.FOREIGN_LISTED)


#: ISO 4217. The list is deliberately short: add a currency when a deal needs it.
KES = "KES"
KNOWN_CURRENCIES = frozenset({"KES", "USD", "ZAR", "GBP", "EUR", "TZS", "UGX", "RWF", "NGN"})


@dataclass(frozen=True)
class PriceInput:
    """A price, with everything needed to judge whether to trust it."""

    amount: float
    currency: str = KES
    origin: Origin = Origin.NSE_FEED
    as_of: dt.date | None = None
    note: str | None = None

    def __post_init__(self) -> None:
        if self.amount <= 0:
            raise ValueError("price must be positive")
        if self.currency not in KNOWN_CURRENCIES:
            raise ValueError(f"{self.currency!r} is not a currency this tool knows; add it deliberately")
        if self.as_of and self.as_of > dt.date.today():
            raise ValueError("a price cannot be dated in the future")
        if self.origin is Origin.PRIVATE_DEAL and not self.note:
            raise ValueError("a private-deal price must say what it is: an offer, a round, a valuation")

    @classmethod
    def coerce(cls, value: "PriceInput | float | int") -> "PriceInput":
        """Accept a bare number as a KES market price, so simple calls stay simple."""
        return value if isinstance(value, cls) else cls(float(value))

    def provenance(self) -> str:
        """The line that appears under the number in the memo."""
        when = f" as at {self.as_of.isoformat()}" if self.as_of else ""
        tail = f" - {self.note}" if self.note else ""
        return f"{self.amount:,.2f} {self.currency}, {self.origin.value}{when}{tail}"

    @property
    def is_stale(self) -> bool:
        """More than four days old: a long weekend plus a public holiday."""
        return bool(self.as_of and (dt.date.today() - self.as_of).days > 4)
