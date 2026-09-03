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
ISIN_HEADERS = ("isin", "isin code", "security code")
SECTOR_HEADERS = ("sector", "segment", "market segment")
NAME_HEADERS = ("name", "company", "security", "company name")
#: The page publishes an explicit download rather than only an inline table.
#: Prefer it: a file is a stable contract, a rendered table is not.
DOWNLOAD_HINT = "daily equity price list"
#: "Statistics as of 02-Sep-2026" sits above the table. Read the date the page
#: states rather than assuming the run date; a run at 00:05 would be a day out.
AS_OF = re.compile(r"statistics\s+as\s+of\s+(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})", re.I)
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
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

    @property
    def is_the_official_download(self) -> bool:
        return DOWNLOAD_HINT in self.label.lower()


def as_of_date(html: str) -> dt.date | None:
    """The trade date the page states for itself, or None if it does not say."""
    match = AS_OF.search(re.sub(r"<[^>]+>", " ", html))
    if not match:
        return None
    day, month, year = match.groups()
    month_number = MONTHS.get(month.lower()[:3])
    return dt.date(int(year), month_number, int(day)) if month_number else None


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
            ("isin", ISIN_HEADERS),
            ("sector", SECTOR_HEADERS),
            ("name", NAME_HEADERS),
            ("close", CLOSE_HEADERS),
            ("volume", VOLUME_HEADERS),
        ):
            for position, cell in enumerate(cells):
                if cell and any(cell == option or cell.startswith(option) for option in options):
                    found.setdefault(key, position)
                    break
        # The published table identifies a security by ISIN and company name,
        # not always by short code, so either identifier will do.
        if ("ticker" in found or "isin" in found or "name" in found) and "close" in found:
            return index, found
    raise ParseFailed(
        "no header row carrying a security identifier and a price column; "
        "the layout changed, or this is not a price list"
    )


def _identify(row: tuple, columns: dict[str, int]) -> tuple[str, str | None]:
    """Return (ticker, isin). Falls back to a slug of the company name."""
    isin = None
    if "isin" in columns:
        candidate = str(row[columns["isin"]] or "").strip().upper()
        if re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}\d", candidate):
            isin = candidate
    if "ticker" in columns:
        ticker = str(row[columns["ticker"]] or "").strip().upper()
        if re.fullmatch(r"[A-Z][A-Z0-9.\-]{1,11}", ticker):
            return ticker, isin
    if "name" in columns:
        # "Williamson Tea Kenya Ltd Ord 5.00" -> WILLIAMSON. Deterministic, and
        # the ISIN remains the identifier that actually matters.
        words = re.findall(r"[A-Za-z]+", str(row[columns["name"]] or ""))
        if words:
            return words[0].upper()[:12], isin
    return "", isin


def parse_workbook(data: bytes, trade_date: dt.date, sector: str | None = None) -> list[Quote]:
    """Parse an NSE price-list workbook into quotes, by column header."""
    book = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    rows = [tuple(r) for r in book[book.sheetnames[0]].iter_rows(values_only=True)]
    start, columns = _header_row(rows)

    quotes: list[Quote] = []
    for row in rows[start + 1:]:
        ticker, isin = _identify(row, columns)
        if not ticker:
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
        row_sector = sector
        if "sector" in columns and row[columns["sector"]]:
            row_sector = str(row[columns["sector"]]).strip().upper()
        quotes.append(Quote(ticker, trade_date, close, volume, SOURCE, isin=isin, sector=row_sector))

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
        stated = as_of_date(page.text)
        if stated:
            trade_date = stated
        files = discover_price_files(page.text)
        if not files:
            raise ParseFailed("no price-list workbook linked from the market statistics page")
        # Prefer the page's own "Download Daily Equity Price List" over any
        # other spreadsheet that happens to be linked.
        newest = next((f for f in files if f.is_the_official_download), files[0])
        if not robots_allows(newest.url, client=client):
            raise SourceRefused(f"robots.txt disallows {newest.url}")
        workbook = client.get(newest.url)
        workbook.raise_for_status()
        return parse_workbook(workbook.content, trade_date)
    finally:
        if owned:
            client.close()
