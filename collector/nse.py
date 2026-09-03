"""NSE end-of-day price adapter.

Source, fixed by Brian: https://www.nse.co.ke/dataservices/market-statistics/

Two honesties are wired into this file rather than left in a comment.

First, **robots.txt is checked before every fetch** and a disallow stops the run.
Second, **the workbook is parsed by column header, not by cell position**, because
a parser pinned to row 7 column D breaks silently the first time a column moves,
and a silent break writes rubbish into the store.

The link-discovery step has NOT been verified against the live page. This
session had no network route to nse.co.ke, so writing selectors against a page
nobody had seen would have been a guess dressed as code. `discover_price_files`
is written generically and is covered by a test that skips until a real saved
copy of the page is dropped into collector/fixtures/. Run it once with a real
sample before this adapter is trusted.
"""
from __future__ import annotations

import datetime as dt
import io
import re
import urllib.parse
import urllib.robotparser
from dataclasses import dataclass

import httpx
import openpyxl

from .store import Quote

SOURCE = "nse.co.ke/dataservices/market-statistics"
PAGE = "https://www.nse.co.ke/dataservices/market-statistics/"
ROBOTS = "https://www.nse.co.ke/robots.txt"
USER_AGENT = "myAnalyst/1.0 (personal research; +https://gachichio.org)"

#: Column headers we accept, lowercased and stripped of punctuation. The NSE has
#: used several wordings over the years; add to these lists rather than editing
#: the parser when a new one appears.
TICKER_HEADERS = ("code", "symbol", "ticker", "counter")
NAME_HEADERS = ("name", "company", "security", "company name")
CLOSE_HEADERS = ("day price", "closing price", "close", "price", "last price", "todays price")
VOLUME_HEADERS = ("volume", "shares traded", "traded volume", "no of shares")


class SourceRefused(RuntimeError):
    """robots.txt disallows this path. Not an error to retry or work around."""


class ParseFailed(RuntimeError):
    """The file did not look like a price list. Never write a partial day."""


@dataclass(frozen=True)
class PriceFile:
    url: str
    label: str


def _normalise(value: object) -> str:
    return re.sub(r"[^a-z ]", " ", str(value or "").lower()).strip()


def robots_allows(url: str, *, client: httpx.Client) -> bool:
    """Ask robots.txt. A fetch that cannot read robots.txt is not attempted."""
    parser = urllib.robotparser.RobotFileParser()
    response = client.get(ROBOTS, timeout=20.0)
    response.raise_for_status()
    parser.parse(response.text.splitlines())
    return parser.can_fetch(USER_AGENT, url)


def make_client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept-Language": "en-GB,en"},
        follow_redirects=True,
        timeout=httpx.Timeout(30.0),
    )


def discover_price_files(html: str, *, base: str = PAGE) -> list[PriceFile]:
    """Find links to price-list workbooks on the market statistics page.

    Generic on purpose: any spreadsheet link whose text or filename mentions a
    price list counts. Verify against a saved copy of the real page before use.
    """
    found: list[PriceFile] = []
    for match in re.finditer(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.I | re.S):
        href, label = match.group(1), re.sub(r"<[^>]+>", " ", match.group(2))
        if not re.search(r"\.xlsx?($|\?)", href, re.I):
            continue
        haystack = f"{href} {label}".lower()
        if not any(word in haystack for word in ("price", "pricelist", "equity", "market")):
            continue
        found.append(PriceFile(url=urllib.parse.urljoin(base, href), label=" ".join(label.split())))
    return found


def _header_row(rows: list[tuple]) -> tuple[int, dict[str, int]]:
    """Locate the header row and map the columns we need onto their indices."""
    for index, row in enumerate(rows[:40]):
        cells = [_normalise(c) for c in row]
        found: dict[str, int] = {}
        for key, options in (
            ("ticker", TICKER_HEADERS),
            ("name", NAME_HEADERS),
            ("close", CLOSE_HEADERS),
            ("volume", VOLUME_HEADERS),
        ):
            for position, cell in enumerate(cells):
                if cell and any(cell == option or cell.startswith(option) for option in options):
                    found.setdefault(key, position)
                    break
        if "ticker" in found and "close" in found:
            return index, found
    raise ParseFailed(
        "no header row carrying a ticker column and a price column; "
        "the layout changed, or this is not a price list"
    )


def parse_workbook(data: bytes, trade_date: dt.date) -> list[Quote]:
    """Parse an NSE price-list workbook into quotes, by column header."""
    book = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    rows = [tuple(r) for r in book[book.sheetnames[0]].iter_rows(values_only=True)]
    start, columns = _header_row(rows)

    quotes: list[Quote] = []
    for row in rows[start + 1:]:
        ticker = str(row[columns["ticker"]] or "").strip().upper()
        if not ticker or not re.fullmatch(r"[A-Z][A-Z0-9.\-]{1,11}", ticker):
            continue
        raw_close = row[columns["close"]]
        try:
            close = float(str(raw_close).replace(",", ""))
        except (TypeError, ValueError):
            continue          # a suspended counter prints a dash, not a price
        if close <= 0:
            continue
        volume = None
        if "volume" in columns:
            try:
                volume = int(float(str(row[columns["volume"]]).replace(",", "")))
            except (TypeError, ValueError):
                volume = None
        quotes.append(Quote(ticker, trade_date, close, volume, SOURCE))

    if len(quotes) < 10:
        raise ParseFailed(f"only {len(quotes)} counters parsed; refusing to store a partial day")
    return quotes


def fetch_latest(trade_date: dt.date, *, client: httpx.Client | None = None) -> list[Quote]:
    """Fetch and parse the newest price list. Raises rather than returning partial data."""
    owned = client is None
    client = client or make_client()
    try:
        if not robots_allows(PAGE, client=client):
            raise SourceRefused(f"robots.txt disallows {PAGE}")
        page = client.get(PAGE)
        page.raise_for_status()
        files = discover_price_files(page.text)
        if not files:
            raise ParseFailed("no price-list workbook linked from the market statistics page")
        newest = files[0]
        if not robots_allows(newest.url, client=client):
            raise SourceRefused(f"robots.txt disallows {newest.url}")
        workbook = client.get(newest.url)
        workbook.raise_for_status()
        return parse_workbook(workbook.content, trade_date)
    finally:
        if owned:
            client.close()
