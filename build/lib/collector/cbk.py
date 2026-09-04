"""Central Bank of Kenya key rates.

Source, fixed by Brian: https://www.centralbank.go.ke/

The home page carries the headline rates as labelled figures. This adapter finds
a figure by its label rather than by position, for the same reason the NSE
adapter reads column headers: a parser pinned to a place breaks silently when
the page is redesigned, and a silent break writes rubbish.

Like the NSE adapter, the extraction rules here have NOT been run against the
live page. This session had no network route to centralbank.go.ke. The rules are
written against the labels CBK publishes under, and `test_cbk_adapter.py` proves
them on a synthetic page; the live test skips until a saved copy of the real
home page is dropped into collector/fixtures/cbk-home.html.
"""
from __future__ import annotations

import datetime as dt
import re

import httpx

from .nse import USER_AGENT, ParseFailed, SourceRefused
from .registry import BY_ID
from .store import Observation

HOME = "https://www.centralbank.go.ke/"
ROBOTS = "https://www.centralbank.go.ke/robots.txt"

#: Label fragments that identify each series on the page, lowercased. Order
#: matters only in that the first match wins, so put the specific before the
#: general: "interbank rate" must be tried before a bare "rate".
LABELS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("cbk.cbr", ("central bank rate", "cbr")),
    ("ke.inflation", ("inflation rate", "overall inflation", "inflation")),
    ("fx.usdkes", ("usd", "us dollar", "dollar")),
)

#: A rate expressed as a percentage, with or without the sign, one or two
#: decimals. Anything outside a sane band is rejected rather than stored.
NUMBER = re.compile(r"(\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?)\s*%?")

BANDS: dict[str, tuple[float, float]] = {
    "cbk.cbr": (0.0, 40.0),
    "ke.inflation": (-10.0, 100.0),
    "fx.usdkes": (50.0, 500.0),
}


def _text(html: str) -> str:
    without_scripts = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", without_scripts))


def extract_rates(html: str, as_of: dt.date) -> list[Observation]:
    """Pull the headline rates off the home page. Returns only what it found."""
    flat = _text(html)
    lowered = flat.lower()
    found: list[Observation] = []

    for series_id, fragments in LABELS:
        if series_id not in BY_ID:
            continue
        for fragment in fragments:
            position = lowered.find(fragment)
            if position < 0:
                continue
            # The figure sits beside its label, before or after. Look forward
            # first, which is the common layout, then a short way back.
            window = flat[position + len(fragment): position + len(fragment) + 60]
            match = NUMBER.search(window)
            if not match:
                match = NUMBER.search(flat[max(0, position - 60): position])
            if not match:
                continue
            try:
                value = float(match.group(1).replace(",", ""))
            except ValueError:
                continue
            low, high = BANDS[series_id]
            if not low <= value <= high:
                continue          # a page number or a year, not a rate
            found.append(Observation(series_id, as_of, value, note=f"label: {fragment}"))
            break

    if not found:
        raise ParseFailed("no recognisable key rate on the CBK home page; the layout changed")
    return found


def fetch_rates(as_of: dt.date | None = None, *, client: httpx.Client | None = None) -> list[Observation]:
    from .nse import make_client, robots_allows

    owned = client is None
    client = client or make_client()
    try:
        if not robots_allows(HOME, client=client):
            raise SourceRefused(f"robots.txt disallows {HOME}")
        response = client.get(HOME, headers={"User-Agent": USER_AGENT})
        response.raise_for_status()
        return extract_rates(response.text, as_of or dt.date.today())
    finally:
        if owned:
            client.close()
