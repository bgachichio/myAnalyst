"""Report what the NSE page actually serves, so the adapter is built on fact.

The collector scraped a 200 and found no price table. Either the table is
rendered in the browser, or the markup moved. Guessing between those from a
distance wastes days; this asks the page directly and prints everything needed
to decide, in one command.
"""
from __future__ import annotations

import json
import re

import httpx

from .htmltable import tables as html_tables
from .nse import PAGE, make_client

#: If a company that is definitely listed never appears in the served HTML, the
#: table is built in the browser and there is nothing to scrape.
CANARIES = ("Kakuzi", "Sasini", "Eaagads", "ISIN", "KE0000")

#: Where a WordPress site keeps the data behind a rendered table.
ENDPOINT = re.compile(
    r"""["'](https?://[^"']+|/[^"']+)["']""" , re.I)
INTERESTING = re.compile(
    r"(wp-json|admin-ajax|/api/|\.json|datatable|ajax|rest_route|graphql)", re.I)


def report() -> None:
    with make_client() as client:
        r = client.get(PAGE)
        html = r.text

        print(f"status              : {r.status_code}")
        print(f"content-type        : {r.headers.get('content-type')}")
        print(f"bytes               : {len(html):,}")
        print()

        print("-- is the data in the served HTML at all? --")
        for word in CANARIES:
            print(f"  {word:<10} {'FOUND' if word.lower() in html.lower() else 'absent'}")
        print()

        found = html_tables(html)
        print(f"-- tables in the HTML: {len(found)} --")
        for i, t in enumerate(found[:8]):
            head = " | ".join(t[0][:8]) if t else ""
            print(f"  [{i}] {len(t)} rows | header: {head[:110]}")
        print()

        print("-- candidate data endpoints --")
        seen: set[str] = set()
        for match in ENDPOINT.finditer(html):
            url = match.group(1)
            if INTERESTING.search(url) and url not in seen:
                seen.add(url)
                print(f"  {url[:150]}")
            if len(seen) >= 25:
                break
        if not seen:
            print("  none")
        print()

        print("-- scripts loaded by the page --")
        for m in list(re.finditer(r'<script[^>]+src=["\']([^"\']+)["\']', html, re.I))[:20]:
            print(f"  {m.group(1)[:150]}")
        print()

        print("-- inline JSON blobs over 200 bytes --")
        for m in list(re.finditer(r'<script[^>]*>\s*(\{.{200,}?\})\s*</script>', html, re.S))[:3]:
            blob = m.group(1)
            try:
                keys = list(json.loads(blob).keys())[:12]
                print(f"  keys: {keys}")
            except json.JSONDecodeError:
                print(f"  unparsed, starts: {blob[:120]}")
        print()

        print("-- spreadsheet links --")
        links = re.findall(r'href=["\']([^"\']+\.xlsx?)["\']', html, re.I)
        for link in links[:10]:
            print(f"  {link[:150]}")
        if not links:
            print("  none")


def main() -> int:
    try:
        report()
    except httpx.HTTPError as exc:
        print(f"fetch failed: {type(exc).__name__}: {exc}")
        return 1
    return 0
