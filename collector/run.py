"""The scheduled collection run.

One job: fetch the day's closes, store them, prune on schedule, emit the JSON
the app reads, and fail loudly. It writes nothing on a partial parse, and it
exits non-zero so the timer surfaces the failure rather than swallowing it.
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys
from pathlib import Path

from . import alert
from .cbk import fetch_rates
from .nse import ParseFailed, SourceRefused, fetch_latest
from .store import DAILY_WINDOW_DAYS, PriceStore

log = logging.getLogger("collector")

#: Collect Monday to Saturday, skip Sunday. The exchange trades Monday to
#: Friday, but the Saturday run is cheap insurance: it picks up a Friday list
#: published late without waiting until Monday. A day with nothing new to
#: collect is reported as skipped, not as a failure. Kenyan public holidays are
#: not encoded: a holiday simply yields no new list.
COLLECTION_DAYS = frozenset({0, 1, 2, 3, 4, 5})   # Mon-Sat


def collect(store: PriceStore, trade_date: dt.date, *, window: int, out_dir: Path | None) -> int:
    if trade_date.weekday() not in COLLECTION_DAYS:
        log.info("%s is a Sunday; nothing to collect", trade_date)
        store.log(trade_date, 0, "skipped", "Sunday")
        return 0

    # The market summary is served in the page itself, so it survives an equity
    # scrape that does not. Two sources, two failure modes, two outcomes.
    indices = 0
    try:
        from .nse import PAGE, make_client, parse_market_summary
        with make_client() as client:
            page = client.get(PAGE)
            page.raise_for_status()
            observations = parse_market_summary(page.text, trade_date)
        indices = store.record(observations)
        if indices:
            log.info("stored %d index levels: %s", indices,
                     ", ".join(o.series_id for o in observations))
    except Exception as exc:
        log.error("market summary unavailable: %s: %s", type(exc).__name__, exc)

    try:
        quotes, trade_date, path = fetch_latest(trade_date)
    except SourceRefused as exc:
        log.error("source refused: %s", exc)
        store.log(trade_date, 0, "refused", str(exc))
        alert.send(f"myAnalyst: NSE source refused on {trade_date}. {exc}")
        return 2
    except ParseFailed as exc:
        log.error("equity prices not parsed, nothing stored for them: %s", exc)
        store.log(trade_date, indices, "equities-parse-failed", str(exc))
        alert.send(
            f"myAnalyst: NSE equity prices would not parse on {trade_date}. "
            f"{indices} index levels were still stored. {exc}"
        )
        store.prune(window_days=window)
        if out_dir:
            store.emit(out_dir)
        return 3
    except Exception as exc:                      # network, HTTP, anything else
        log.exception("collection failed")
        store.log(trade_date, 0, "error", f"{type(exc).__name__}: {exc}")
        alert.send(f"myAnalyst: collection failed on {trade_date}. {type(exc).__name__}: {exc}")
        return 4

    written = store.upsert(quotes)
    store.log(trade_date, written, "ok", f"via {path}")
    log.info("stored %d closes for %s, scraped from the %s", written, trade_date, path)

    # The key rates are a separate source with a separate failure mode. A CBK
    # outage must not discard a good day of prices, so it is caught on its own.
    try:
        rates = fetch_rates(trade_date)
        store.record(rates)
        log.info("stored %d key rates: %s", len(rates), ", ".join(r.series_id for r in rates))
    except (ParseFailed, SourceRefused) as exc:
        log.error("key rates unavailable, prices kept: %s", exc)
        store.log(trade_date, 0, "rates-failed", str(exc))
    except Exception as exc:
        log.exception("key rates failed")
        store.log(trade_date, 0, "rates-error", f"{type(exc).__name__}: {exc}")

    report = store.prune(window_days=window)
    log.info("%s", report.line())

    if out_dir:
        index = store.emit(out_dir)
        log.info("emitted %s", index)
    return 0


def health(store: PriceStore, *, stale_after: int = 4) -> int:
    """Say plainly whether the collector is doing its job. Exit 0 only if it is.

    Success is not "the process ran". It is "a good day of prices landed
    recently", which is the only thing the app actually depends on.
    """
    latest = store.latest()
    counters = len(latest)
    rates = sum(len(v) for v in store.observations().values())
    failures = store.recent_failures(days=7)
    last = max((dt.date.fromisoformat(r["trade_date"]) for r in latest), default=None)

    if last is None:
        log.error("HEALTH FAIL: the store holds no prices at all")
        return 1

    age = (dt.date.today() - last).days
    log.info(
        "last close %s (%d days old) · %d counters · %d rate observations · %d failures in 7 days",
        last, age, counters, rates, failures,
    )
    if age > stale_after:
        log.error("HEALTH FAIL: newest close is %d days old, over the %d-day limit", age, stale_after)
        alert.send(
            f"myAnalyst: no new NSE close for {age} days (newest {last}). "
            "The app is showing stale prices."
        )
        return 1
    log.info("HEALTH OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Collect NSE end-of-day prices.")
    # A directory of JSON files, not a database file. The DuckDB name outlived
    # the engine by several commits.
    ap.add_argument("--db", default="/var/lib/myanalyst/store")
    # "private", never "public": a directory called public will be served by
    # something eventually, and NSE data may not be redistributed.
    ap.add_argument("--out", default="/srv/myanalyst/private",
                    help="where the app reads the JSON from")
    ap.add_argument("--window", type=int, default=DAILY_WINDOW_DAYS, help="trading days of daily history kept")
    ap.add_argument("--date", default=None, help="trade date, YYYY-MM-DD; defaults to today")
    ap.add_argument("--prune-only", action="store_true", help="run the clean-up without fetching")
    ap.add_argument("--health", action="store_true", help="report state and exit non-zero if stale")
    ap.add_argument("--test-alert", action="store_true",
                    help="fire one alert on purpose, to prove the channel works")
    ap.add_argument("--stale-after", type=int, default=4,
                    help="days without a successful collection before health fails")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    trade_date = dt.date.fromisoformat(args.date) if args.date else dt.date.today()

    if args.test_alert:
        ok = alert.send("myAnalyst: test alert, fired on purpose. If you are reading this, the channel works.")
        log.info("test alert %s", "delivered" if ok else "FAILED")
        return 0 if ok else 1

    with PriceStore(args.db) as store:
        if args.health:
            return health(store, stale_after=args.stale_after)
        if args.prune_only:
            log.info("%s", store.prune(window_days=args.window).line())
            return 0
        return collect(store, trade_date, window=args.window, out_dir=Path(args.out) if args.out else None)


if __name__ == "__main__":
    sys.exit(main())
