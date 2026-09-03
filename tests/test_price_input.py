"""Where a price came from, and what the memo must say about it."""
from __future__ import annotations

import datetime as dt

import pytest

from kernel import Inputs, Origin, Parameters, PriceInput, value
from tests.test_kernel import CASES, _params

INPUTS = Inputs(**CASES[0]["inputs"])
PRICE = CASES[0]["price"]


def _value(price, **over):
    return value(INPUTS, price, _params(**over))


def test_a_bare_number_is_still_a_kes_market_price():
    """The simple call stays simple, and the fixtures keep working."""
    v = _value(PRICE)
    assert v.price.currency == "KES"
    assert v.price.origin is Origin.NSE_FEED
    assert v.warnings == ()


def test_a_hand_typed_price_reaches_the_same_verdict_but_says_so():
    """The feed will fail one Tuesday. The tool must not."""
    typed = PriceInput(PRICE, origin=Origin.MANUAL, as_of=dt.date.today(), note="NSE page down")
    v = _value(typed)
    assert v.decision == _value(PRICE).decision
    assert any("entered by hand" in w for w in v.warnings)
    assert "manual" in v.provenance


def test_a_private_deal_price_is_flagged_as_not_a_market_price():
    deal = PriceInput(PRICE, origin=Origin.PRIVATE_DEAL, note="Series A offer, 20% for KES 200m")
    v = _value(deal)
    assert any("not a market price" in w for w in v.warnings)
    assert "Series A offer" in v.provenance


def test_a_private_deal_price_must_say_what_it_is():
    with pytest.raises(ValueError, match="what it is"):
        PriceInput(10.0, origin=Origin.PRIVATE_DEAL)


def test_a_foreign_price_against_a_shilling_rate_is_flagged():
    """A dollar company discounted at the GoK yield double-counts Kenyan risk."""
    foreign = PriceInput(PRICE, currency="USD", origin=Origin.FOREIGN_LISTED)
    warnings = _value(foreign).warnings
    assert any("discount rate is a KES rate" in w for w in warnings)


def test_a_foreign_price_against_a_matching_rate_is_clean():
    foreign = PriceInput(PRICE, currency="USD", origin=Origin.FOREIGN_LISTED)
    v = _value(foreign, currency="USD", c=0.0, r=0.045)
    assert not any("discount rate" in w for w in v.warnings)


def test_a_stale_price_is_flagged():
    old = PriceInput(PRICE, as_of=dt.date.today() - dt.timedelta(days=10))
    assert any("stale" in w for w in _value(old).warnings)


def test_a_fresh_price_is_not_flagged_over_a_long_weekend():
    fresh = PriceInput(PRICE, as_of=dt.date.today() - dt.timedelta(days=4))
    assert not any("stale" in w for w in _value(fresh).warnings)


@pytest.mark.parametrize(
    "bad",
    [{"amount": 0.0}, {"amount": -1.0}, {"currency": "XYZ"},
     {"as_of": dt.date.today() + dt.timedelta(days=1)}],
    ids=["zero", "negative", "unknown currency", "dated tomorrow"],
)
def test_implausible_prices_are_refused(bad):
    fields = {"amount": 10.0, "currency": "KES"}
    fields.update(bad)
    with pytest.raises(ValueError):
        PriceInput(**fields)


def test_the_origin_never_changes_the_arithmetic():
    """Provenance is reported, never priced in. Only the reader adjusts."""
    plain = _value(PRICE)
    for origin, note in (
        (Origin.MANUAL, None),
        (Origin.PRIVATE_DEAL, "an offer"),
        (Origin.FOREIGN_PRIVATE, None),
    ):
        v = _value(PriceInput(PRICE, origin=origin, note=note))
        assert v.my_valuation == plain.my_valuation
        assert v.market_price_fe == plain.market_price_fe
