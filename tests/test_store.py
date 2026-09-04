"""Retention and pruning. The storage rule has to hold before the parser exists."""
from __future__ import annotations

import datetime as dt

import pytest

from collector.store import MAX_COUNTERS_PER_DAY, PriceStore, Quote


def _series(store: PriceStore, ticker: str, days: int, start: dt.date) -> None:
    """Write `days` consecutive weekday quotes, oldest first."""
    d, written = start, 0
    while written < days:
        if d.weekday() < 5:
            store.upsert([Quote(ticker, d, 10.0 + written / 100, 1000, "test")])
            written += 1
        d += dt.timedelta(days=1)


@pytest.fixture()
def store(tmp_path):
    with PriceStore(tmp_path / "store") as s:
        yield s


def test_prune_keeps_the_window_and_drops_the_rest(store):
    _series(store, "UNGA", 500, dt.date(2023, 1, 2))
    report = store.prune(window_days=400)
    assert report.daily_rows_before == 500
    assert report.daily_rows_after == 400
    assert report.daily_rows_deleted == 100


def test_prune_is_per_counter_not_global(store):
    _series(store, "UNGA", 500, dt.date(2023, 1, 2))
    _series(store, "LBTY", 50, dt.date(2024, 1, 1))
    store.prune(window_days=400)
    import json as _json
    window = {t: len(_json.loads((store.daily / f"{t}.json").read_text())) for t in ("UNGA", "LBTY")}
    assert window["UNGA"] == 400, "the busy counter is trimmed to the window"
    assert window["LBTY"] == 50, "a thinly traded counter must not lose its history"
    assert len(store.series("UNGA")) > 400, "and the archive reaches back beyond it"


def test_month_ends_survive_the_prune(store):
    _series(store, "UNGA", 500, dt.date(2023, 1, 2))
    import json
    early = json.loads((store.daily / "UNGA.json").read_text())[0]["d"]
    store.prune(window_days=400)
    kept_from = json.loads((store.daily / "UNGA.json").read_text())[0]["d"]
    archived = [r for r in json.loads((store.monthly / "UNGA.json").read_text()) if r["d"] < kept_from]
    assert kept_from > early, "the window really did move"
    assert archived, "pruned months must remain reachable as month-ends"


def test_prune_is_idempotent(store):
    _series(store, "UNGA", 500, dt.date(2023, 1, 2))
    store.prune(window_days=400)
    second = store.prune(window_days=400)
    assert second.daily_rows_deleted == 0


def test_series_joins_the_archive_to_the_window_without_duplicates(store):
    _series(store, "UNGA", 500, dt.date(2023, 1, 2))
    store.prune(window_days=400)
    series = store.series("UNGA")
    dates = [row["date"] for row in series]
    assert dates == sorted(dates)
    assert len(dates) == len(set(dates)), "a month-end must not appear twice"
    assert len(series) > 400, "the archive extends the window backwards"


def test_a_runaway_parser_is_refused(store):
    day = dt.date(2026, 9, 2)
    flood = [Quote(f"T{i:03d}", day, 1.0, None, "test") for i in range(MAX_COUNTERS_PER_DAY + 1)]
    with pytest.raises(ValueError, match="wrong table"):
        store.upsert(flood)


@pytest.mark.parametrize(
    "bad",
    [
        {"close": 0.0},
        {"close": -3.0},
        {"ticker": ""},
        {"trade_date": dt.date.today() + dt.timedelta(days=1)},
    ],
    ids=["zero price", "negative price", "no ticker", "dated tomorrow"],
)
def test_implausible_quotes_are_refused(bad):
    fields = {"ticker": "UNGA", "trade_date": dt.date(2026, 9, 2), "close": 28.0, "volume": None, "source": "test"}
    fields.update(bad)
    with pytest.raises(ValueError):
        Quote(**fields)


def test_rewriting_a_day_replaces_it(store):
    day = dt.date(2026, 9, 2)
    store.upsert([Quote("UNGA", day, 28.0, 100, "test")])
    store.upsert([Quote("UNGA", day, 29.5, 120, "test")])
    rows = store.series("UNGA")
    assert [r["close"] for r in rows] == [29.5], "a corrected price list must overwrite, not duplicate"


def test_emit_writes_what_the_app_reads(store, tmp_path):
    _series(store, "UNGA", 10, dt.date(2026, 8, 3))
    index = store.emit(tmp_path / "public")
    assert index.exists()
    assert (tmp_path / "public" / "series" / "UNGA.json").exists()


def test_a_public_emit_is_refused_while_nse_data_is_private(store, tmp_path):
    """The licence rule lives in code, not in a comment."""
    import pytest as _pytest

    with _pytest.raises(PermissionError, match="private use only"):
        store.emit(tmp_path / "public", private=False)


def test_a_private_emit_is_allowed(store, tmp_path):
    _series(store, "UNGA", 5, dt.date(2026, 8, 24))
    assert store.emit(tmp_path / "mine", private=True).exists()
