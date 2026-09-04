# myAnalyst

Equity analysis on Brian's own model, in the browser, with the arithmetic
shown. Built for one user and deployed to one machine.

## What it does

**Reads the report.** A published annual report or a spreadsheet, parsed in the
browser: no upload, no service, no key. A label table and arithmetic, so the
same report gives the same figures every time. Every figure it offers carries
the line it was read off, the page it was on, a confidence, and the runners-up.
Anything it is unsure about is offered for confirmation, never filled in
silently. It detects the reporting scale rather than assuming it, refuses to
multiply a share count by it, and keeps the comparative column so the graphs
fill themselves.

**Values it.** The kernel is the 2016 UNGA and Liberty workbooks in code:
future value of long-run earnings at `g`, discounted at the GoK yield `r`, a
margin of safety `k`, the market's price of future earnings, the cigar-butt net
asset test, and the fragility sheet with its ±10% stress. Five sector profiles,
because a miller has working capital and an insurer does not; the Focus Model
ratio is suppressed where it would be a number that lies.

**Writes the memo.** All eight parts `brian` §4 asks for: a base case and a
worst case with their assumptions printed, revenue, profit and net assets over
the periods the report gives, the deal priced as a deal (EV/EBITDA, an exit at
the entry multiple, the return to it, debt capacity, interest cover), where the
upside would have to come from, the two hurdles with bitcoin compared
explicitly at a rate you set, the 0–7 economic energy score with each
component's reason, and BUY / HOLD / SELL with bulleted rationale. Plus the
four factors — Price, Tailwind, Moat, Leadership — which ask for the reason
before the verdict rather than after it.

**Assesses a private deal twice.** A venture lens that buys the exit and backs
out what may be paid today, and a private equity lens that buys today's
earnings at a listed comparable's multiple with the illiquidity discount
printed rather than folded in. Five tests on whether the earnings are earnings,
where a figure the deck omits is a finding and never a pass. The capital stack
tested against today's EBITDA, never against the projection. Where the two
lenses disagree, the disagreement is the finding and it is printed, not
averaged.

**Watches the calendar.** A dividend is announced with a books-closure date,
and the failure is silent: buy on that date, settle three trading days later,
learn about it from the absence of a payment. The watchlist works backwards
through settlement, weekends and Kenya's gazetted holidays, and counts down in
trading days. Idd follows the moon, so it is added by hand and the screen says
why.

**Compares across borders.** A multiple does not travel. Saved memos are shown
as quoted and restated onto one discount rate, with the arithmetic printed.

**Collects what it needs.** The collector runs unattended, Monday to Saturday.
It scrapes the day's closes off the NSE market statistics page and the key
rates off the CBK home page, stores them as plain JSON, prunes what has aged
out, and writes the index the app reads. Nobody downloads or uploads anything.
What stays manual is the part no exchange publishes: the documents behind a
question, and the price of a private company.

`collector/registry.py` is the contract for what may be held: every series
names the decision it changes, its cadence, its retention, and its licence
status. Retention is tiered — 400 trading days at full resolution, month-end
closes for ever, slow series such as annual GDP kept entire. The whole store is
about 1 MB and a daily run peaks at 32 MB of memory, both measured.

Nothing here computes a verdict with a language model. Every figure is
reproducible from its inputs and the parameters printed beside it.

## How to run it

```sh
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest -q      # kernel, store, collector: 103 tests
npm install && npm test            # the browser kernel against the same fixtures: 99
npm run check                      # the built app in a real browser, both themes
npm run dev                        # http://localhost:5173
```

`npm run check` is the one that matters before shipping. It serves the build,
drives it in Chromium at 390px in both themes, pushes the real PDF fixture
through the real file input, and asserts the twelve figures arrive at the right
scale and reach a verdict.

The collector, against a local store:

```sh
myanalyst-collect --db ./store --out ./public --date 2026-09-02
myanalyst-collect --db ./store --prune-only
myanalyst-collect --db ./store --health
```

## Fixtures

Three, and two of them are generated so they cannot drift from the third:

- `fixtures/kernel-fixtures.json` — the UNGA and Liberty workbooks, every
  expected value computed by the implementation and read for plausibility
  before it was written down.
- `fixtures/statement-lines.json` — a statement as the readers hand it over.
- `fixtures/statement.xlsx` and `fixtures/statement.pdf` — written from that
  file by `scripts/make-statement-workbook.py` and
  `scripts/make-statement-pdf.py`. All three ingestion paths are held to one
  bar: from the file alone, reproduce the UNGA inputs to the shilling.

## Deploying and rolling back

`DEPLOY.md` has the whole procedure, both artefacts, and the rollback. In
short: build on the Lenovo, never on the VM. `./deploy.sh` ships the collector,
`./deploy-app.sh` ships the app — and refuses to ship either if the tests or
the browser check fail.

To stop the collector: `systemctl disable --now myanalyst-collect.timer`. The
store is append-and-prune with no migration, so an older binary reads a newer
file. To reverse a bad day, delete that date's file from the store and re-run
for it.
