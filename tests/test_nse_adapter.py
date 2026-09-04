"""Parser behaviour, proved on synthetic workbooks and on a real saved page when one exists."""
from __future__ import annotations

import datetime as dt
import io
from pathlib import Path

import openpyxl
import pytest

from collector.nse import ParseFailed, discover_price_files, parse_workbook

FIXTURES = Path(__file__).resolve().parents[1] / "collector" / "fixtures"
DAY = dt.date(2026, 9, 2)


def _workbook(header: list[str], rows: list[list], preamble: int = 3) -> bytes:
    book = openpyxl.Workbook()
    sheet = book.active
    for _ in range(preamble):
        sheet.append(["NAIROBI SECURITIES EXCHANGE"])
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def _counters(n: int) -> list[list]:
    return [[f"CO{i:02d}", f"Counter {i}", 10.0 + i, 1000 + i] for i in range(n)]


def test_parses_a_conventional_price_list():
    data = _workbook(["CODE", "NAME", "DAY PRICE", "VOLUME"], _counters(20))
    quotes = parse_workbook(data, DAY)
    assert len(quotes) == 20
    assert quotes[0].ticker == "CO00"
    assert quotes[0].close == 10.0
    assert quotes[0].volume == 1000


def test_columns_may_move_without_breaking_it():
    """A parser pinned to a cell position breaks silently. This one must not."""
    data = _workbook(["VOLUME", "NAME", "CODE", "CLOSING PRICE"],
                     [[1000 + i, f"Counter {i}", f"CO{i:02d}", 10.0 + i] for i in range(20)])
    quotes = parse_workbook(data, DAY)
    assert len(quotes) == 20
    assert quotes[0].ticker == "CO00" and quotes[0].close == 10.0


def test_suspended_counters_are_skipped_not_zeroed():
    rows = _counters(20)
    rows[5][2] = "-"
    quotes = parse_workbook(_workbook(["CODE", "NAME", "PRICE", "VOLUME"], rows), DAY)
    assert len(quotes) == 19
    assert all(q.close > 0 for q in quotes)


def test_a_partial_day_is_refused():
    with pytest.raises(ParseFailed, match="partial day"):
        parse_workbook(_workbook(["CODE", "NAME", "PRICE", "VOLUME"], _counters(4)), DAY)


def test_an_unrecognisable_file_is_refused():
    with pytest.raises(ParseFailed, match="header row"):
        parse_workbook(_workbook(["FOO", "BAR", "BAZ"], [["a", "b", "c"]] * 20), DAY)


def test_discovers_spreadsheet_links():
    html = """
      <a href="/wp-content/uploads/daily-pricelist-02092026.xlsx">Daily Price List 2 Sep 2026</a>
      <a href="/about/">About the exchange</a>
      <a href="/wp-content/uploads/annual-report.pdf">Annual report</a>
    """
    files = discover_price_files(html)
    assert len(files) == 1
    assert files[0].url.endswith("daily-pricelist-02092026.xlsx")


@pytest.mark.skipif(
    not (FIXTURES / "market-statistics.html").exists(),
    reason="drop a real saved copy of the NSE market statistics page into collector/fixtures/ to verify discovery",
)
def test_discovery_works_against_the_real_page():
    html = (FIXTURES / "market-statistics.html").read_text(errors="replace")
    files = discover_price_files(html)
    assert files, "no price-list workbook found on the real page; the discovery rule needs widening"


@pytest.mark.skipif(
    not list(FIXTURES.glob("*.xlsx")),
    reason="drop a real NSE price-list workbook into collector/fixtures/ to verify parsing",
)
def test_parsing_works_against_a_real_workbook():
    sample = sorted(FIXTURES.glob("*.xlsx"))[0]
    quotes = parse_workbook(sample.read_bytes(), DAY)
    assert len(quotes) >= 20
    assert all(q.close > 0 for q in quotes)


# --- what the real page actually looks like -------------------------------
# Structure taken from the live page on 2 September 2026: a sector dropdown,
# "Statistics as of 02-Sep-2026", a "Download Daily Equity Price List" link,
# and a table keyed by Company and ISIN Code rather than by short code.

REAL_SHAPE = """
  <div class="tabs">Market Statistics Summary | Equity Statistics | Bonds Statistics</div>
  <select><option>AGRICULTURAL</option><option>BANKING</option></select>
  <p>Statistics as of 02-Sep-2026</p>
  <a href="/wp-content/uploads/Daily-Equity-Price-List-02-09-2026.xlsx">Download Daily Equity Price List</a>
  <a href="/wp-content/uploads/equity-statistics-archive.xlsx">Equity Statistics Archive</a>
  <a href="/wp-content/uploads/bond-statistics.xlsx">Bond Statistics</a>
  <table><tr><th>Company</th><th>ISIN Code</th><th>Volume</th></tr></table>
"""


def test_reads_the_trade_date_the_page_states():
    from collector.nse import as_of_date
    assert as_of_date(REAL_SHAPE) == dt.date(2026, 9, 2)


def test_prefers_the_official_download_over_other_spreadsheets():
    files = discover_price_files(REAL_SHAPE)
    labels = [f.label for f in files]
    assert "Download Daily Equity Price List" in labels
    assert "Equity Statistics Archive" in labels, "a competing spreadsheet must reach the choice"
    assert "Bond Statistics" not in labels, "bond statistics is not a price list"
    chosen = next(f for f in files if f.is_the_official_download)
    assert "Daily-Equity-Price-List" in chosen.url


def test_parses_a_table_keyed_by_company_and_isin():
    """The published table carries no short code. ISIN and name must be enough."""
    rows = [
        ["Kakuzi Ord.5.00", "KE0000000281", 756, 400.0],
        ["Sasini Ltd Ord 1.00", "KE0000000430", 10845, 22.5],
        ["Eaagads Ltd Ord 1.25", "KE0000000208", 756, 12.0],
        ["Williamson Tea Kenya Ltd Ord 5.00", "KE0000000505", 8484, 145.0],
        ["Kapchorua Tea Co. Ltd Ord Ord 5.00", "KE4000001760", 2556, 90.0],
        ["Limuru Tea Co. Ltd Ord 20.00", "KE0000000356", 21, 320.0],
    ] * 2
    data = _workbook(["Company", "ISIN Code", "Volume", "Day Price"], rows)
    quotes = parse_workbook(data, DAY, sector="AGRICULTURAL")

    assert len(quotes) == 12
    kakuzi = quotes[0]
    assert kakuzi.isin == "KE0000000281"
    assert kakuzi.ticker == "KAKUZI"
    assert kakuzi.sector == "AGRICULTURAL"
    assert kakuzi.close == 400.0
    assert kakuzi.volume == 756


def test_a_malformed_isin_is_dropped_not_stored():
    rows = [[f"Counter {i} Ltd", "NOT-AN-ISIN", 100, 10.0 + i] for i in range(20)]
    quotes = parse_workbook(_workbook(["Company", "ISIN Code", "Volume", "Price"], rows), DAY)
    assert len(quotes) == 20
    assert all(q.isin is None for q in quotes), "a bad ISIN is discarded, never persisted"


# --- scraping the page itself, the primary path ---------------------------
# Markup modelled on the live page: a sector heading, the stated date, and a
# table keyed by Company and ISIN Code, exactly as it renders on 2 Sep 2026.

PAGE_HTML = """
<div class="tabs">Market Statistics Summary | Equity Statistics | Bonds Statistics</div>
<select><option>AGRICULTURAL</option><option>BANKING</option></select>
<p>Statistics as of 02-Sep-2026</p>
<a href="/wp-content/uploads/Daily-Equity-Price-List-02-09-2026.xlsx">Download Daily Equity Price List</a>
<table>
  <thead><tr><th>Company</th><th>ISIN Code</th><th>Volume</th><th>Day Price</th></tr></thead>
  <tbody>
    <tr><td>Kakuzi Ord.5.00</td><td>KE0000000281</td><td>756</td><td>400.00</td></tr>
    <tr><td>Sasini Ltd Ord 1.00</td><td>KE0000000430</td><td>10,845</td><td>22.50</td></tr>
    <tr><td>Eaagads Ltd Ord 1.25</td><td>KE0000000208</td><td>756</td><td>12.00</td></tr>
    <tr><td>Williamson Tea Kenya Ltd Ord 5.00</td><td>KE0000000505</td><td>8,484</td><td>145.00</td></tr>
    <tr><td>Kapchorua Tea Co. Ltd Ord Ord 5.00</td><td>KE4000001760</td><td>2,556</td><td>90.00</td></tr>
    <tr><td>Limuru Tea Co. Ltd Ord 20.00</td><td>KE0000000356</td><td>21</td><td>320.00</td></tr>
    <tr><td>Suspended Counter Ltd</td><td>KE0000000999</td><td>-</td><td>-</td></tr>
  </tbody>
</table>
<table><tr><th>Notice</th></tr><tr><td>Trading hours 09:00 to 15:00</td></tr></table>
"""


def test_scrapes_the_price_table_off_the_page():
    from collector.nse import parse_page_tables

    quotes = parse_page_tables(PAGE_HTML, DAY, sector="AGRICULTURAL")
    assert len(quotes) == 6, "six priced counters; the suspended one is skipped"

    kakuzi = quotes[0]
    assert kakuzi.ticker == "KAKUZI"
    assert kakuzi.isin == "KE0000000281"
    assert kakuzi.close == 400.0
    assert kakuzi.volume == 756
    assert kakuzi.sector == "AGRICULTURAL"

    sasini = next(q for q in quotes if q.ticker == "SASINI")
    assert sasini.volume == 10845, "thousands separators must not defeat the parse"


def test_a_table_that_is_not_a_price_list_is_ignored():
    from collector.nse import parse_page_tables

    quotes = parse_page_tables(PAGE_HTML, DAY)
    assert all(q.ticker != "TRADING" for q in quotes)


def test_a_page_with_no_price_table_yields_nothing_rather_than_guessing():
    from collector.nse import parse_page_tables

    assert parse_page_tables("<p>Welcome to the exchange.</p>", DAY) == []


def test_the_same_counter_is_never_stored_twice():
    from collector.nse import parse_page_tables

    doubled = PAGE_HTML + PAGE_HTML
    quotes = parse_page_tables(doubled, DAY)
    assert len({q.ticker for q in quotes}) == len(quotes)


def test_similar_company_names_do_not_collide_into_one_counter():
    """A one-word ticker collides on a real board and silently drops a counter."""
    from collector.nse import parse_page_tables

    html = """
    <table><tr><th>Company</th><th>ISIN Code</th><th>Volume</th><th>Day Price</th></tr>
      <tr><td>Standard Chartered Bank Kenya Ltd</td><td>KE0000000101</td><td>100</td><td>150.00</td></tr>
      <tr><td>Standard Group Ltd</td><td>KE0000000102</td><td>200</td><td>8.00</td></tr>
      <tr><td>Kenya Power Ltd</td><td>KE0000000103</td><td>300</td><td>2.00</td></tr>
      <tr><td>Kenya Airways Ltd</td><td>KE0000000104</td><td>400</td><td>3.00</td></tr>
    </table>"""
    quotes = parse_page_tables(html, DAY)
    assert len(quotes) == 4, "four distinct securities must survive as four"
    assert len({q.isin for q in quotes}) == 4
    assert len({q.ticker for q in quotes}) == 4, f"tickers collided: {[q.ticker for q in quotes]}"


def test_a_name_made_only_of_common_words_still_yields_a_counter():
    """A priced row with an ISIN is never dropped for want of a tidy ticker."""
    from collector.nse import parse_page_tables

    html = """
    <table><tr><th>Company</th><th>ISIN Code</th><th>Volume</th><th>Day Price</th></tr>
      <tr><td>The Company Group Ltd</td><td>KE0000000201</td><td>10</td><td>5.00</td></tr>
    </table>"""
    quotes = parse_page_tables(html, DAY)
    assert len(quotes) == 1
    assert quotes[0].ticker, "a ticker was derived rather than the row being skipped"
    assert quotes[0].isin == "KE0000000201"
