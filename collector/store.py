"""End-of-day store, as plain JSON on disk.

Rung 0 of the data ladder (`building` §2.3). Sixty-five counters and a rolling
window is not a database problem: it is a few megabytes of text. Plain JSON
means no engine to install, no file format to migrate, no process holding a
hundred megabytes to write a hundred rows, and a store the app can read
directly.

Shape on disk:

    <data>/prices/daily/<TICKER>.json     rolling window, oldest first
    <data>/prices/monthly/<TICKER>.json   month-end closes, kept for ever
    <data>/series/<series_id>.json        key rates and indices
    <data>/index.json                     what the app reads first
    <data>/log.jsonl                      collection outcomes, capped

One file per counter is deliberate: a prune or an append touches one small file,
so memory never scales with the size of the store.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .registry import BY_ID

#: Trading days of full daily history kept per counter. About eighteen months,
#: which covers a 52-week range and a one-year return with headroom.
DAILY_WINDOW_DAYS = 400

#: Refuse a day claiming more counters than the NSE could list. A parser that
#: has started reading the wrong table trips this rather than filling the store.
MAX_COUNTERS_PER_DAY = 200

#: The log is a diary, not an archive.
MAX_LOG_LINES = 500

ISIN = re.compile(r"[A-Z]{2}[A-Z0-9]{9}\d")


def _write_atomic(path: Path, payload: object) -> None:
    """Write via a temporary file in the same directory, then rename.

    A half-written store is worse than a missing one: the app would read it and
    believe it.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(payload, fh, separators=(",", ":"))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _read(path: Path, fallback):
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return fallback     # a corrupt file is replaced by the next good day


@dataclass(frozen=True)
class Quote:
    ticker: str
    trade_date: dt.date
    close: float
    volume: int | None
    source: str
    isin: str | None = None
    sector: str | None = None

    def __post_init__(self) -> None:
        if not self.ticker or len(self.ticker) > 12:
            raise ValueError(f"implausible ticker: {self.ticker!r}")
        if self.close <= 0:
            raise ValueError(f"{self.ticker}: close must be positive, got {self.close}")
        if self.trade_date > dt.date.today():
            raise ValueError(f"{self.ticker}: trade date is in the future")
        if self.isin is not None and not ISIN.fullmatch(self.isin):
            raise ValueError(f"{self.ticker}: {self.isin!r} is not a well-formed ISIN")


@dataclass(frozen=True)
class Observation:
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
            f"prune: {self.daily_rows_deleted} price rows and {self.series_rows_deleted} series rows "
            f"removed, {self.daily_rows_after} closes kept, {self.monthly_rows} month-ends archived, "
            f"{self.bytes_on_disk / 1024:.0f} KB on disk"
        )


class PriceStore:
    def __init__(self, path: str | Path) -> None:
        # `path` is a directory. A file path is accepted and its parent used, so
        # an existing --db argument keeps working.
        p = Path(path)
        self.root = p.parent / p.stem if p.suffix else p
        self.daily = self.root / "prices" / "daily"
        self.monthly = self.root / "prices" / "monthly"
        self.series_dir = self.root / "series"
        for d in (self.daily, self.monthly, self.series_dir):
            d.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------- lifecycle
    def close(self) -> None:      # nothing to close; kept so callers need not care
        pass

    def __enter__(self) -> "PriceStore":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def _tickers(self) -> list[str]:
        return sorted(p.stem for p in self.daily.glob("*.json"))

    def _meta_path(self) -> Path:
        return self.root / "counters.json"

    # ----------------------------------------------------------------- write
    def upsert(self, quotes: list[Quote], fetched_at: dt.datetime | None = None) -> int:
        """Insert or replace one day's quotes. Returns rows written."""
        if not quotes:
            return 0
        if len(quotes) > MAX_COUNTERS_PER_DAY:
            raise ValueError(
                f"{len(quotes)} counters in one day exceeds the {MAX_COUNTERS_PER_DAY} ceiling; "
                "the parser is probably reading the wrong table"
            )
        stamp = (fetched_at or dt.datetime.now(dt.timezone.utc)).replace(tzinfo=None).isoformat(timespec="seconds")
        meta = _read(self._meta_path(), {})

        for q in quotes:
            path = self.daily / f"{q.ticker}.json"
            rows = _read(path, [])
            day = q.trade_date.isoformat()
            rows = [r for r in rows if r["d"] != day]       # a corrected list overwrites
            rows.append({"d": day, "c": q.close, "v": q.volume})
            rows.sort(key=lambda r: r["d"])
            _write_atomic(path, rows)
            meta[q.ticker] = {
                "isin": q.isin, "sector": q.sector, "source": q.source, "fetched_at": stamp,
            }

        _write_atomic(self._meta_path(), meta)
        return len(quotes)

    def record(self, observations: list[Observation], fetched_at: dt.datetime | None = None) -> int:
        if not observations:
            return 0
        stamp = (fetched_at or dt.datetime.now(dt.timezone.utc)).replace(tzinfo=None).isoformat(timespec="seconds")
        by_series: dict[str, list[Observation]] = {}
        for o in observations:
            by_series.setdefault(o.series_id, []).append(o)

        for series_id, obs in by_series.items():
            path = self.series_dir / f"{series_id}.json"
            rows = _read(path, [])
            days = {o.obs_date.isoformat() for o in obs}
            rows = [r for r in rows if r["d"] not in days]
            rows.extend({"d": o.obs_date.isoformat(), "v": o.value, "n": o.note,
                         "src": BY_ID[o.series_id].source, "at": stamp} for o in obs)
            rows.sort(key=lambda r: r["d"])
            _write_atomic(path, rows)
        return len(observations)

    def log(self, trade_date: dt.date | None, counters: int, outcome: str, detail: str = "") -> None:
        path = self.root / "log.jsonl"
        entry = {
            "at": dt.datetime.now(dt.timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds"),
            "date": trade_date.isoformat() if trade_date else None,
            "counters": counters, "outcome": outcome, "detail": detail[:400],
        }
        lines = path.read_text().splitlines() if path.exists() else []
        lines.append(json.dumps(entry, separators=(",", ":")))
        path.write_text("\n".join(lines[-MAX_LOG_LINES:]) + "\n")

    def recent_failures(self, days: int = 7) -> int:
        path = self.root / "log.jsonl"
        if not path.exists():
            return 0
        cutoff = (dt.datetime.now(dt.timezone.utc).replace(tzinfo=None) - dt.timedelta(days=days)).isoformat()
        n = 0
        for line in path.read_text().splitlines():
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("at", "") >= cutoff and e.get("outcome") not in ("ok", "skipped"):
                n += 1
        return n

    # ----------------------------------------------------------------- prune
    def prune(self, window_days: int = DAILY_WINDOW_DAYS) -> PruneReport:
        """Archive month-ends, then drop daily rows beyond the rolling window.

        One counter at a time, so peak memory is one counter's history, not the
        whole store. The window counts trading days actually held, so a counter
        suspended for a month does not lose its history to the calendar.
        """
        before = after = monthly_total = 0

        for ticker in self._tickers():
            daily_path = self.daily / f"{ticker}.json"
            rows = _read(daily_path, [])
            before += len(rows)

            # Month-ends are archived before anything is deleted, so a prune can
            # never lose a month that existed only as daily rows.
            monthly_path = self.monthly / f"{ticker}.json"
            archive = {r["d"]: r["c"] for r in _read(monthly_path, [])}
            last_of_month: dict[str, dict] = {}
            for r in rows:
                last_of_month[r["d"][:7]] = r
            for r in last_of_month.values():
                archive[r["d"]] = r["c"]
            merged = [{"d": d, "c": c} for d, c in sorted(archive.items())]
            _write_atomic(monthly_path, merged)
            monthly_total += len(merged)

            kept = rows[-window_days:] if len(rows) > window_days else rows
            if len(kept) != len(rows):
                _write_atomic(daily_path, kept)
            after += len(kept)

        series_before = series_after = 0
        for path in sorted(self.series_dir.glob("*.json")):
            series = BY_ID.get(path.stem)
            rows = _read(path, [])
            series_before += len(rows)
            if series and series.retention_days is not None and len(rows) > series.retention_days:
                rows = rows[-series.retention_days:]
                _write_atomic(path, rows)
            series_after += len(rows)

        return PruneReport(
            daily_rows_before=before,
            daily_rows_after=after,
            daily_rows_deleted=before - after,
            monthly_rows=monthly_total,
            series_rows_deleted=series_before - series_after,
            bytes_on_disk=sum(f.stat().st_size for f in self.root.rglob("*") if f.is_file()),
        )

    # ------------------------------------------------------------------ read
    def latest(self) -> list[dict]:
        meta = _read(self._meta_path(), {})
        out = []
        for ticker in self._tickers():
            rows = _read(self.daily / f"{ticker}.json", [])
            if not rows:
                continue
            m = meta.get(ticker, {})
            out.append({
                "ticker": ticker, "trade_date": rows[-1]["d"], "close": rows[-1]["c"],
                "isin": m.get("isin"), "sector": m.get("sector"),
                "source": m.get("source"), "fetched_at": m.get("fetched_at"),
            })
        return out

    def series(self, ticker: str) -> list[dict]:
        """Month-end archive then the daily window, oldest first, deduplicated."""
        daily = _read(self.daily / f"{ticker}.json", [])
        monthly = _read(self.monthly / f"{ticker}.json", [])
        earliest = daily[0]["d"] if daily else "9999-12-31"
        rows = [{"date": r["d"], "close": r["c"]} for r in monthly if r["d"] < earliest]
        rows.extend({"date": r["d"], "close": r["c"]} for r in daily)
        return rows

    def observations(self) -> dict[str, list[dict]]:
        return {
            p.stem: [{"date": r["d"], "value": r["v"]} for r in _read(p, [])]
            for p in sorted(self.series_dir.glob("*.json"))
        }

    def emit(self, out_dir: str | Path, *, private: bool = True) -> Path:
        """Write the index the app reads first.

        `private` must stay true for any path that is not solely Brian's own
        device: NSE data is held for private use and is withheld from a public
        emit. Refusing here is cheaper than a takedown.
        """
        out = Path(out_dir)
        if not private:
            withheld = [s.series_id for s in BY_ID.values() if not s.publishable]
            if withheld:
                raise PermissionError(
                    "refusing a public emit: " + ", ".join(sorted(withheld))
                    + " are held for private use only (see LICENCE-NOTES.md)"
                )
        (out / "series").mkdir(parents=True, exist_ok=True)
        latest = self.latest()
        _write_atomic(out / "latest.json", {
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "window_days": DAILY_WINDOW_DAYS,
            "counters": latest,
            "series": {sid: BY_ID[sid].label for sid in self.observations() if sid in BY_ID},
        })
        for row in latest:
            _write_atomic(out / "series" / f"{row['ticker']}.json", self.series(row["ticker"]))
        _write_atomic(out / "series-observations.json", self.observations())
        return out / "latest.json"
