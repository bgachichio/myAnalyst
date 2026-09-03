"""The registry is the contract: what may be held, why, and for how long."""
from __future__ import annotations

import datetime as dt

import pytest

from collector.registry import BY_ID, REGISTRY, Cadence, Licence, collectable, storage_estimate_bytes
from collector.store import Observation, PriceStore


@pytest.fixture()
def store(tmp_path):
    with PriceStore(tmp_path / "prices.duckdb") as s:
        yield s


def test_every_series_names_the_decision_it_changes():
    for s in REGISTRY:
        assert len(s.decision) > 20, f"{s.series_id} does not say what it is for"


def test_the_discount_rate_and_the_hurdle_are_both_registered():
    """r is the kernel's spine; the Bitcoin hurdle is mandatory under brian §4."""
    assert "gok.bond.yield" in BY_ID
    assert "btc.usd" in BY_ID


def test_restricted_series_are_registered_but_never_collectable():
    restricted = [s for s in REGISTRY if s.licence is Licence.RESTRICTED]
    assert restricted, "the ones we decided not to hold must stay written down"
    assert all(s not in collectable() for s in restricted)


def test_a_restricted_series_cannot_be_recorded():
    with pytest.raises(ValueError, match="restricted"):
        Observation("us.djia", dt.date(2026, 9, 2), 41000.0)


def test_an_unregistered_series_cannot_be_recorded():
    with pytest.raises(ValueError, match="not in the registry"):
        Observation("nse.invented", dt.date(2026, 9, 2), 1.0)


def test_slow_series_are_kept_entire_and_daily_series_are_windowed(store):
    day = dt.date(2024, 1, 1)
    store.record([Observation("nse.nasi", day + dt.timedelta(days=i), 100.0 + i) for i in range(500)])
    store.record([Observation("ke.gdp.growth", dt.date(2000 + i, 12, 31), 5.0) for i in range(24)])

    report = store.prune()

    held = dict(store.db.execute(
        "SELECT series_id, count(*) FROM series_observations GROUP BY series_id"
    ).fetchall())
    assert held["nse.nasi"] == BY_ID["nse.nasi"].retention_days
    assert held["ke.gdp.growth"] == 24, "an annual series must never be pruned"
    assert report.series_rows_deleted == 100


def test_prune_of_series_is_idempotent(store):
    day = dt.date(2024, 1, 1)
    store.record([Observation("nse.nasi", day + dt.timedelta(days=i), 100.0 + i) for i in range(500)])
    store.prune()
    assert store.prune().series_rows_deleted == 0


def test_the_whole_store_stays_small():
    """Storage is not the binding constraint here, and the estimate must say so."""
    assert storage_estimate_bytes(years=20) < 16 * 1024 * 1024


def test_daily_series_all_declare_a_window():
    for s in collectable():
        if s.cadence is Cadence.DAILY:
            assert s.retention_days, f"{s.series_id} is daily and must declare a window"
