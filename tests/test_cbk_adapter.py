"""CBK key-rate extraction, proved on a synthetic page and on a real one when supplied."""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from collector.cbk import extract_rates
from collector.nse import ParseFailed

FIXTURES = Path(__file__).resolve().parents[1] / "collector" / "fixtures"
DAY = dt.date(2026, 9, 3)

PAGE = """
<html><body>
  <div class="rates">
    <div><span>Central Bank Rate</span><strong>9.25%</strong></div>
    <div><span>Inflation Rate</span><strong>4.10%</strong></div>
    <div><span>USD</span><strong>129.45</strong></div>
  </div>
  <script>var year = 2026;</script>
</body></html>
"""


def _by_id(observations):
    return {o.series_id: o.value for o in observations}


def test_pulls_the_headline_rates():
    values = _by_id(extract_rates(PAGE, DAY))
    assert values["cbk.cbr"] == 9.25
    assert values["ke.inflation"] == 4.10
    assert values["fx.usdkes"] == 129.45


def test_the_figure_may_sit_before_its_label():
    page = "<div><strong>9.25%</strong><span>Central Bank Rate</span></div>"
    assert _by_id(extract_rates(page, DAY))["cbk.cbr"] == 9.25


def test_script_contents_are_never_read_as_a_rate():
    page = "<script>centralBankRate = 999;</script><div>Central Bank Rate <b>9.25%</b></div>"
    assert _by_id(extract_rates(page, DAY))["cbk.cbr"] == 9.25


@pytest.mark.parametrize(
    "page",
    [
        "<div>Central Bank Rate <b>412.00</b></div>",   # outside a sane band
        "<div>USD <b>3.10</b></div>",                    # a rate, not an exchange rate
    ],
    ids=["implausible policy rate", "exchange rate out of band"],
)
def test_implausible_figures_are_refused(page):
    with pytest.raises(ParseFailed):
        extract_rates(page, DAY)


def test_a_redesigned_page_fails_loudly():
    with pytest.raises(ParseFailed, match="layout changed"):
        extract_rates("<html><body><p>Welcome to the Bank.</p></body></html>", DAY)


def test_observations_are_dated_and_attributed():
    for observation in extract_rates(PAGE, DAY):
        assert observation.obs_date == DAY
        assert observation.note and observation.note.startswith("label:")


@pytest.mark.skipif(
    not (FIXTURES / "cbk-home.html").exists(),
    reason="drop a real saved copy of the CBK home page into collector/fixtures/cbk-home.html to verify",
)
def test_extraction_works_against_the_real_home_page():
    html = (FIXTURES / "cbk-home.html").read_text(errors="replace")
    values = _by_id(extract_rates(html, DAY))
    assert "cbk.cbr" in values, "the Central Bank Rate must be found on the real page"
    assert 0 < values["cbk.cbr"] < 40
