"""Find the endpoint behind the rendered equity table, systematically.

The table is built in the browser, so the rows come from somewhere the markup
does not name. Rather than ask a person to read a Network tab, this tries the
small number of shapes a WordPress site actually uses, and reports which one
returns something price-shaped.

Read-only. It sends GETs and one POST per candidate action to the site's own
AJAX endpoint, at a human pace, and stores nothing.
"""
from __future__ import annotations

import json
import re
import time

import httpx

from .nse import PAGE, make_client, parse_json_feed, parse_page_tables
from .htmltable import tables as html_tables
import datetime as dt

AJAX = "https://www.nse.co.ke/dataservices/wp-admin/admin-ajax.php"
REST = "https://www.nse.co.ke/dataservices/wp-json/"

#: Query parameters a sector dropdown commonly drives on a server-rendered page.
QUERY_KEYS = ("sector", "market_segment", "segment", "category", "cat", "filter")
SECTORS = ("AGRICULTURAL", "BANKING")

#: Actions used by the table plugins that appear on WordPress finance sites.
ACTIONS = (
    "get_equity_statistics", "equity_statistics", "get_market_statistics",
    "market_statistics", "get_equities", "equities", "get_stocks",
    "wpDataTablesGetData", "get_wdtable", "wdt_load_child_rows",
    "tablepress_get_table", "get_price_list", "price_list",
    "nse_equity_statistics", "nse_market_statistics", "load_equity_data",
)

DELAY = 1.0   # be a polite guest on someone else's server


def _looks_like_prices(payload: object) -> tuple[bool, int, str]:
    today = dt.date.today()
    if isinstance(payload, (list, dict)):
        quotes = parse_json_feed(payload, today)
        if quotes:
            return True, len(quotes), "json feed"
    if isinstance(payload, str):
        quotes = parse_page_tables(payload, today)
        if quotes:
            return True, len(quotes), "html table"
        if any(w in payload.lower() for w in ("kakuzi", "sasini", "eaagads", "ke0000")):
            return True, 0, "contains counter names but no parsable table"
    return False, 0, ""


def _decode(r: httpx.Response) -> object:
    try:
        return r.json()
    except ValueError:
        return r.text


def _try(label: str, fn) -> bool:
    try:
        r = fn()
    except httpx.HTTPError as exc:
        print(f"  {label:<58} {type(exc).__name__}")
        return False
    payload = _decode(r)
    hit, n, how = _looks_like_prices(payload)
    size = len(r.text)
    if hit:
        print(f"  {label:<58} {r.status_code} {size:>7,}B  *** {n} counters, {how} ***")
        return True
    print(f"  {label:<58} {r.status_code} {size:>7,}B")
    return False


def main() -> int:
    winners: list[str] = []
    with make_client() as client:
        print("-- the page with a sector query parameter --")
        for key in QUERY_KEYS:
            for sector in SECTORS[:1]:
                url = f"{PAGE}?{key}={sector}"
                if _try(f"GET ?{key}={sector}", lambda u=url: client.get(u)):
                    winners.append(url)
                time.sleep(DELAY)

        print()
        print("-- the REST index, for a route that serves the table --")
        try:
            routes = client.get(REST).json().get("routes", {})
            interesting = [r for r in routes if re.search(r"(equit|market|stat|price|stock|table)", r, re.I)]
            for route in interesting[:12]:
                print(f"  route: {route}")
            if not interesting:
                print("  no route mentions equities, market, prices, stocks or tables")
        except Exception as exc:
            print(f"  unreadable: {type(exc).__name__}")

        print()
        print("-- admin-ajax actions --")
        for action in ACTIONS:
            if _try(f"POST action={action}", lambda a=action: client.post(AJAX, data={"action": a})):
                winners.append(f"{AJAX} action={action}")
            time.sleep(DELAY)

    print()
    if winners:
        print("FOUND. Send these lines back:")
        for w in winners:
            print(f"  {w}")
        return 0
    print("Nothing here returned a price list.")
    print("Read it off the browser instead: F12, Network, filter XHR, change the")
    print("sector dropdown. The request that repopulates the table is the feed;")
    print("send its URL and its Payload.")
    return 1
