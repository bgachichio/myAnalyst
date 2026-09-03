# myAnalyst

## What it does

Reproduces Brian's own NSE equity valuation, to the shilling, and collects the
end-of-day prices it needs to run.

The kernel is the 2016 UNGA and Liberty workbooks in code: future value of
long-run earnings at `g`, discounted at the GoK yield `r`, a margin of safety
`k`, the market's price of future earnings, the cigar-butt net asset test, and
the fragility sheet with its ±10% stress. Two sector profiles are wired, because
a miller has working capital and an insurer does not; the Focus Model ratio is
suppressed where it would be a number that lies.

The collector holds eleven registered series: the GoK benchmark yield that sets
the discount rate, the Central Bank Rate, Kenya inflation and real GDP growth,
NSE closes, NASI, the NSE 25 and the banking sector index, and the Bitcoin
hurdle. Two more are registered and deliberately not collected. `collector/registry.py`
is the contract: every series names the decision it changes, its cadence, its
retention, and whether its licence has actually been checked.

Retention is tiered and registry-driven: 400 trading days of full resolution for
anything daily, month-end closes archived for ever, and slow series such as
annual GDP kept entire. Twenty years of all of it comes to about 2 MB, so
storage is not the binding constraint and the code says so in a test.

Nothing here computes a verdict with a language model. Every figure is
reproducible from its inputs and the parameters printed beside it.

## How to run it

```sh
pip install -e ".[dev]" && python -m pytest -q   # kernel + store, 30 tests
npm install && npm test                          # the TypeScript kernel, same fixtures
myanalyst-collect --db ./prices.duckdb --out ./public --date 2026-09-02
myanalyst-collect --db ./prices.duckdb --prune-only
```

On the VM the collector runs from `deploy/myanalyst-collect.timer`, weekdays at
15:00 UTC. It never builds there; the artefact is built on the Lenovo and shipped.

## How to roll it back

The collector is a one-shot timer with no migration and no state the app cannot
rebuild. To stop it: `systemctl disable --now myanalyst-collect.timer`. To revert
the code: check out the previous tag and re-run `pip install -e .`; the store is
append-and-prune, so an older binary reads a newer file without conversion. To
reverse a bad day of prices, delete that date and re-run for it:

```sh
duckdb prices.duckdb "DELETE FROM daily_prices WHERE trade_date = DATE '2026-09-02'"
myanalyst-collect --date 2026-09-02
```

A full deployment document is due at milestone 8, before anything is served.
