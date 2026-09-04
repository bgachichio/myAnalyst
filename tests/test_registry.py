"""The registry is the contract: what may be held, why, and for how long."""
from __future__ import annotations

import datetime as dt

import pytest

from collector.registry import BY_ID, REGISTRY, Cadence, Licence, collectable, storage_estimate_bytes
from collector.store import Observation, PriceStore


@pytest.fixture()
def store(tmp_path):
    with PriceStore(tmp_path / "store") as s:
        yield s


def test_every_series_names_the_decision_it_changes():
    for s in REGISTRY:
        assert len(s.decision) > 20, f"{s.series_id} does not say what it is for"


def test_the_discount_rate_and_the_hurdle_are_both_registered():
    """r is the kernel's spine; the Bitcoin hurdle is mandatory under brian §4."""
    assert "gok.bond.yield" in BY_ID
    assert "btc.usd" in BY_ID


def test_nse_data_is_marked_private_use_only():
    """The NSE page asserts its data is proprietary and may not be copied.

    So NSE series may be held on Brian's own machine and must never be emitted
    to a path anything else can read. This is the rule that keeps a convenience
    cache from becoming redistribution.
    """
    nse = [s for s in REGISTRY if s.series_id.startswith("nse.")]
    assert nse
    for s in nse:
        assert s.licence is Licence.PROPRIETARY_PRIVATE_USE
        assert not s.publishable


def test_public_sources_stay_publishable():
    for series_id in ("cbk.cbr", "ke.gdp.growth", "fx.usdkes"):
        assert BY_ID[series_id].publishable


def test_a_restricted_series_cannot_be_recorded():
    """No series is restricted today; the guard must still hold if one is added."""
    from dataclasses import replace

    from collector import store as store_module

    guarded = replace(BY_ID["nse.nasi"], series_id="test.restricted", licence=Licence.RESTRICTED)
    store_module.BY_ID["test.restricted"] = guarded
    try:
        with pytest.raises(ValueError, match="restricted"):
            Observation("test.restricted", dt.date(2026, 9, 2), 1.0)
    finally:
        del store_module.BY_ID["test.restricted"]


def test_an_unregistered_series_cannot_be_recorded():
    with pytest.raises(ValueError, match="not in the registry"):
        Observation("nse.invented", dt.date(2026, 9, 2), 1.0)


def test_slow_series_are_kept_entire_and_daily_series_are_windowed(store):
    day = dt.date(2024, 1, 1)
    store.record([Observation("nse.nasi", day + dt.timedelta(days=i), 100.0 + i) for i in range(500)])
    store.record([Observation("ke.gdp.growth", dt.date(2000 + i, 12, 31), 5.0) for i in range(24)])

    report = store.prune()

    held = {k: len(v) for k, v in store.observations().items()}
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
