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
