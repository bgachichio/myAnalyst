"""End-of-day price store with tiered retention.

The app needs very little price history. The kernel needs one price: the current
one. The mandatory charts are drawn from reported financials, not from ticks.
Everything beyond a rolling window is kept only so a 52-week range and a
one-year return can be computed, and month-ends are kept because they cost
almost nothing and answer "what was this worth in March 2019".

So: full daily for a rolling window, month-end closes for ever, and a prune that
runs on a schedule and reports what it removed.
"""
from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path

import duckdb

from .registry import BY_ID, Cadence, Series

#: Trading days of full daily history kept per counter. About eighteen months,
#: which covers a 52-week range and a one-year return with headroom to spare.
DAILY_WINDOW_DAYS = 400

#: Refuse to write a day that claims more counters than the NSE could list.
#: A parser that has started reading the wrong table trips this rather than
#: quietly filling the store with rubbish.
MAX_COUNTERS_PER_DAY = 200

SCHEMA = """
CREATE TABLE IF NOT EXISTS daily_prices (
    ticker      VARCHAR NOT NULL,
    trade_date  DATE    NOT NULL,
    close       DOUBLE  NOT NULL,
    volume      BIGINT,
    source      VARCHAR NOT NULL,
    fetched_at  TIMESTAMP NOT NULL,
    PRIMARY KEY (ticker, trade_date)
);
CREATE TABLE IF NOT EXISTS monthly_prices (
    ticker      VARCHAR NOT NULL,
    month_end   DATE    NOT NULL,
    close       DOUBLE  NOT NULL,
    source      VARCHAR NOT NULL,
    PRIMARY KEY (ticker, month_end)
);
CREATE TABLE IF NOT EXISTS series_observations (
    series_id   VARCHAR NOT NULL,
    obs_date    DATE    NOT NULL,
    value       DOUBLE  NOT NULL,
    note        VARCHAR,
    source      VARCHAR NOT NULL,
    fetched_at  TIMESTAMP NOT NULL,
    PRIMARY KEY (series_id, obs_date)
);
CREATE TABLE IF NOT EXISTS collection_log (
    run_at      TIMESTAMP NOT NULL,
    trade_date  DATE,
    counters    INTEGER   NOT NULL,
    outcome     VARCHAR   NOT NULL,
    detail      VARCHAR
);
"""


@dataclass(frozen=True)
class Quote:
    ticker: str
    trade_date: dt.date
    close: float
    volume: int | None
    source: str

    def __post_init__(self) -> None:
        if not self.ticker or len(self.ticker) > 12:
            raise ValueError(f"implausible ticker: {self.ticker!r}")
        if self.close <= 0:
            raise ValueError(f"{self.ticker}: close must be positive, got {self.close}")
        if self.trade_date > dt.date.today():
            raise ValueError(f"{self.ticker}: trade date is in the future")


@dataclass(frozen=True)
class Observation:
    """One value of one registered series: an index level, a yield, a growth rate."""

    series_id: str
    obs_date: dt.date
    value: float
    note: str | None = None

    def __post_init__(self) -> None:
        if self.series_id not in BY_ID:
            raise ValueError(f"{self.series_id!r} is not in the registry; register it before collecting it")
        if not BY_ID[self.series_id].collectable:
            raise ValueError(f"{self.series_id!r} is registered as restricted and must not be collected")
        if self.obs_date > dt.date.today():
            raise ValueError(f"{self.series_id}: observation is dated in the future")


@dataclass(frozen=True)
class PruneReport:
    daily_rows_before: int
    daily_rows_after: int
    daily_rows_deleted: int
    monthly_rows: int
    series_rows_deleted: int
    bytes_on_disk: int

    def line(self) -> str:
        return (
            f"prune: {self.daily_rows_deleted} price rows and {self.series_rows_deleted} series rows removed, "
            f"{self.daily_rows_after} closes kept, {self.monthly_rows} month-ends archived, "
            f"{self.bytes_on_disk / 1024:.0f} KB on disk"
        )


class PriceStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = duckdb.connect(str(self.path))
        self.db.execute(SCHEMA)

    def close(self) -> None:
        self.db.close()

    def __enter__(self) -> "PriceStore":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    # ------------------------------------------------------------------ write

    def upsert(self, quotes: list[Quote], fetched_at: dt.datetime | None = None) -> int:
        """Insert or replace one day's quotes. Returns the row count written."""
        if not quotes:
            return 0
        if len(quotes) > MAX_COUNTERS_PER_DAY:
            raise ValueError(
                f"{len(quotes)} counters in one day exceeds the {MAX_COUNTERS_PER_DAY} ceiling; "
                "the parser is probably reading the wrong table"
            )
        stamp = fetched_at or dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
        rows = [(q.ticker, q.trade_date, q.close, q.volume, q.source, stamp) for q in quotes]
        self.db.executemany(
            "INSERT OR REPLACE INTO daily_prices "
            "(ticker, trade_date, close, volume, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )
        return len(rows)

    def record(self, observations: list[Observation], fetched_at: dt.datetime | None = None) -> int:
        """Insert or replace observations of registered series."""
        if not observations:
            return 0
        stamp = fetched_at or dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
        rows = [
            (o.series_id, o.obs_date, o.value, o.note, BY_ID[o.series_id].source, stamp)
            for o in observations
        ]
        self.db.executemany(
            "INSERT OR REPLACE INTO series_observations "
            "(series_id, obs_date, value, note, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )
        return len(rows)

    def log(self, trade_date: dt.date | None, counters: int, outcome: str, detail: str = "") -> None:
        self.db.execute(
            "INSERT INTO collection_log (run_at, trade_date, counters, outcome, detail) VALUES (?, ?, ?, ?, ?)",
            [dt.datetime.now(dt.timezone.utc).replace(tzinfo=None), trade_date, counters, outcome, detail],
        )

    # ------------------------------------------------------------------ prune

    def prune(self, window_days: int = DAILY_WINDOW_DAYS) -> PruneReport:
        """Archive month-ends, then drop daily rows beyond the rolling window.

        The window is counted in trading days actually held per counter, not in
        calendar days, so a counter that was suspended for a month does not lose
        its history to the calendar.
        """
        before = self.db.execute("SELECT count(*) FROM daily_prices").fetchone()[0]

        # Month-end closes are archived before anything is deleted, so pruning
        # can never lose a month that was only ever held as a daily row.
        self.db.execute(
            """
            INSERT OR REPLACE INTO monthly_prices (ticker, month_end, close, source)
            SELECT ticker, trade_date, close, source
            FROM (
                SELECT ticker, trade_date, close, source,
                       row_number() OVER (
                           PARTITION BY ticker, date_trunc('month', trade_date)
                           ORDER BY trade_date DESC
                       ) AS rn
                FROM daily_prices
            )
            WHERE rn = 1
            """
        )

        self.db.execute(
            """
            DELETE FROM daily_prices WHERE (ticker, trade_date) IN (
                SELECT ticker, trade_date FROM (
                    SELECT ticker, trade_date,
                           row_number() OVER (PARTITION BY ticker ORDER BY trade_date DESC) AS rn
                    FROM daily_prices
                ) WHERE rn > ?
            )
            """,
            [window_days],
        )

        # Each registered series prunes to its own window. A series declaring
        # retention_days = None arrives a few times a year and is kept entire.
        series_before = self.db.execute("SELECT count(*) FROM series_observations").fetchone()[0]
        for series in BY_ID.values():
            if series.retention_days is None:
                continue
            self.db.execute(
                """
                DELETE FROM series_observations WHERE (series_id, obs_date) IN (
                    SELECT series_id, obs_date FROM (
                        SELECT series_id, obs_date,
                               row_number() OVER (PARTITION BY series_id ORDER BY obs_date DESC) AS rn
                        FROM series_observations WHERE series_id = ?
                    ) WHERE rn > ?
                )
                """,
                [series.series_id, series.retention_days],
            )
        series_after = self.db.execute("SELECT count(*) FROM series_observations").fetchone()[0]

        after = self.db.execute("SELECT count(*) FROM daily_prices").fetchone()[0]
        monthly = self.db.execute("SELECT count(*) FROM monthly_prices").fetchone()[0]
        self.db.execute("CHECKPOINT")

        return PruneReport(
            daily_rows_before=before,
            daily_rows_after=after,
            daily_rows_deleted=before - after,
            monthly_rows=monthly,
            series_rows_deleted=series_before - series_after,
            bytes_on_disk=self.path.stat().st_size if self.path.exists() else 0,
        )

    # ------------------------------------------------------------------- read

    def latest(self) -> list[dict]:
        """The most recent close held for every counter."""
        return [
            {"ticker": t, "trade_date": d.isoformat(), "close": c, "source": s, "fetched_at": f.isoformat()}
            for t, d, c, s, f in self.db.execute(
                """
                SELECT ticker, trade_date, close, source, fetched_at FROM (
                    SELECT *, row_number() OVER (PARTITION BY ticker ORDER BY trade_date DESC) AS rn
                    FROM daily_prices
                ) WHERE rn = 1 ORDER BY ticker
                """
            ).fetchall()
        ]

    def series(self, ticker: str) -> list[dict]:
        """Daily window then month-end archive, oldest first, deduplicated."""
        rows = self.db.execute(
            """
            SELECT month_end AS d, close FROM monthly_prices WHERE ticker = ?
            AND month_end < (SELECT coalesce(min(trade_date), DATE '9999-12-31')
                             FROM daily_prices WHERE ticker = ?)
            UNION ALL
            SELECT trade_date AS d, close FROM daily_prices WHERE ticker = ?
            ORDER BY d
            """,
            [ticker, ticker, ticker],
        ).fetchall()
        return [{"date": d.isoformat(), "close": c} for d, c in rows]

    def observations(self) -> dict[str, list[dict]]:
        """Every registered series the store holds, oldest first."""
        out: dict[str, list[dict]] = {}
        for sid, d, v in self.db.execute(
            "SELECT series_id, obs_date, value FROM series_observations ORDER BY series_id, obs_date"
        ).fetchall():
            out.setdefault(sid, []).append({"date": d.isoformat(), "value": v})
        return out

    def emit(self, out_dir: str | Path) -> Path:
        """Write the compact JSON the app reads. One index, one file per counter."""
        out = Path(out_dir)
        (out / "series").mkdir(parents=True, exist_ok=True)
        latest = self.latest()
        index = {
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "window_days": DAILY_WINDOW_DAYS,
            "counters": latest,
        }
        index["series"] = {
            sid: BY_ID[sid].label
            for (sid,) in self.db.execute(
                "SELECT DISTINCT series_id FROM series_observations ORDER BY series_id"
            ).fetchall()
        }
        (out / "latest.json").write_text(json.dumps(index, indent=1))
        (out / "series-observations.json").write_text(json.dumps(self.observations()))
        for row in latest:
            (out / "series" / f"{row['ticker']}.json").write_text(json.dumps(self.series(row["ticker"])))
        return out / "latest.json"
