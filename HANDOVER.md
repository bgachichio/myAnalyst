---
title: myAnalyst — handover
owner: Brian Gachichio Karanja
status: LIVE at https://analyst.gachichio.org
date: 4 September 2026
purpose: Everything a new session needs to continue this build without re-deriving it
---

# myAnalyst — handover

**Read this first, then `GATES.md` for the graded record and `DEPLOY.md` for the
runbook.** This document exists so a cold session can pick the build up without
re-litigating decisions already made or repeating failures already paid for.

- **Repository:** `github.com/bgachichio/myAnalyst`, branch `main`, 38 commits.
- **Build brief:** `myanalyst-build-brief.md` v1.4, on branch
  `claude/myanalyst-investment-pwa-neki09` of `github.com/bgachichio/skills`.
- **Live:** `https://analyst.gachichio.org`, basic auth, username `brian`.
- **Verification:** 103 Python tests, 107 TypeScript tests, 47 browser checks
  against the built app in Chromium. Zero dependency advisories at any level.

---

## 1. WHAT BRIAN ASKED FOR

Five goals, in his own words and his own priority labels. This is the contract.

| | Goal | Priority |
|---|---|---|
| **(i)** | A comprehensive equity investment analysis tool | **"goal!"** |
| **(ii)** | Ingest financial/annual reports of an NSE-listed company, check the latest NSE share price, generate a valuation estimation and investment recommendation | **"must!"** |
| **(iii)** | Review non-listed company data (information memorandum, pitch deck), find a comparable NSE company, make a venture-capital-based thesis recommendation | **"must!"** |
| **(iv)** | Scan the internet for comparables on other African exchanges (primary: jse.co.za) | *"nice to have!"* |
| **(v)** | Notifications and reminders — for example, buy before the share register closes for a dividend | *"nice to have!"* |

**The intent behind the goals.** The tool is *inspired by* Brian's 2017 Excel
workbooks, his decision-factor documents and the Equity Investment Playbook —
**not a reproduction of them**. He corrected this explicitly: an earlier brief
made reproducing the workbooks the destination, and it is not. The workbooks
are the proof that the process works; the app is the machine that makes it
repeatable and adds what a spreadsheet cannot do — watch a dividend calendar,
read a report, hold two valuation lenses against each other.

**Standing decisions Brian has made. Do not re-open these.**

| Decision | Detail |
|---|---|
| Withholding tax | **5%**, resident, holdings under 12.5%. Not the 15% in `brian` §4, which is the non-resident rate |
| NSE transaction costs | **~2.6% on entry only**, never on exit. Exposed as a Settings slider, 0%–10% |
| Indices | **Ignore NASDAQ and the Dow.** No part of the mandatory output turns on them |
| NSE data | Automated collection is acceptable — private use only, under the page's proprietary notice, enforced in code |
| Ingestion | **Scrape, never download-and-upload.** Manual entry stays only for a user's own query: an IM, a deal sheet, or the price of a private company |
| Determinism | **No language model in the verdict path.** "Deterministic-and-confirmable rather than waiting on a LiteLLM gateway" |
| Hosting | The VM at `34.35.177.164`, **not Vercel**. App and data on one origin |
| Bitcoin | An explicit comparison on every analysis, at a rate the user sets and the memo prints. Reported, never a veto |

---

## 2. WHERE IT STANDS

### Done and live

- **(i) Comprehensive analysis.** All eight parts `brian` §4 requires: base and
  worst case with assumptions printed; revenue, profit and net-asset trends; the
  deal priced as a private equity deal; where the upside would have to come
  from; both hurdles with bitcoin explicit; the 0–7 Economic Energy Score with
  each component's reason; and BUY / HOLD / SELL with bulleted rationale. Plus
  the four decision factors — Price, Tailwind, Moat, Leadership.
- **(ii) Ingestion → valuation → recommendation.** PDF and spreadsheet read in
  the browser, deterministically. **Except the NSE price** — see below.
- **(iii) Private deals.** Two lenses that are allowed to disagree, five
  quality-of-earnings tests, capital stack tested against today's earnings.
  **Except finding the comparable** — see below.
- **(v) Dividend calendar.** T+3 settlement through weekends and Kenya's
  gazetted holidays, counted in trading days.

### Not done — the three open gaps

**Gap 1 — the app cannot fetch an NSE share price.** The equity table on
`nse.co.ke/dataservices/market-statistics/` is rendered in the browser; no
company name appears in the served HTML. Three index levels do collect (NASI,
NSE 25, Banking). `collector/probe.py` was written to find the real endpoint and
has been run once: it reached `admin-ajax.php` and got WordPress's "unknown
action" for all sixteen guesses, found no useful REST route, and found that
sector query parameters change nothing.

**What is needed:** on the NSE page, F12 → Network → XHR → change the sector
dropdown, and capture the **`action=` value in the request payload**. The URL
alone is not enough; the probe already reaches admin-ajax.

**Fallbacks, ranked, if the action cannot be found:** africanfinancials.com
(already in `brian` §4's source list), then the NSE's own published daily price
list if a stable URL exists. **Do not put a headless browser on the VM** —
Chromium needs roughly 300 MB against 485 MB free, and the memory law exists
for a reason.

**Gap 2 — nothing wires a collected price into the form.** Independent of Gap 1.
The Analyse screen reports how many counters the collector holds and offers no
way to pick one. Planned: a counter picker that fills price and trade date and
sets the origin to `nse-feed` with its staleness warning.

**Gap 3 — the comparable is typed, not found.** `Private.tsx` takes an anchor
name and multiple by hand. The collector holds each counter's **sector**, and
the Compare store holds **EV/EBITDA per memo already analysed**, so this is
buildable from what exists: offer a saved memo as the anchor, and list
sector-matched counters as candidates.

### Also not true yet

- No alert has ever been delivered. Telegram is configured but the channel has
  not been proven end to end.
- No restore drill has been held.
- Scanned/image PDFs are not readable. That needs OCR (tesseract.js, ~2 MB).
  The I&M report was **not** a scan — it had text; the bank labels were the
  problem.

---

## 3. ARCHITECTURE

Two artefacts on one machine, sharing one origin and nothing else.

```
Brian's Lenovo                     GCP e2-micro "pulse", 34.35.177.164
──────────────                     ────────────────────────────────────
npm run build   ─── deploy-app.sh ──▶  /srv/myanalyst/app     (static PWA)
python -m build ─── deploy.sh     ──▶  /opt/myanalyst/…       (collector)
                                        │
                                        └─▶ /srv/myanalyst/private  (JSON)
                                                    ▲
                              Caddy ────────────────┘
                              analyst.gachichio.org, basic auth
                              app at /, collector's data at /data
```

**Why one origin.** A browser cannot read `nse.co.ke` cross-origin, and NSE data
must not sit on a public CDN. One hostname behind one password solves both.

### The browser side — React 19 + Vite 8 + Tailwind v4

Everything that produces a verdict runs in the browser. No back end, no account,
no upload. A report is read on the device and never leaves it.

| File | What it holds |
|---|---|
| `src/lib/kernel.ts` | The valuation kernel: FV of long-run earnings at `g`, discounted at `r`, margin of safety `k`, the market's price of future earnings, the cigar-butt NAV test, the fragility sheet at ±10% |
| `src/lib/analysis.ts` | Verdict with HOLD as a real third state, multiples, IRR by bisection, the two hurdles, the 0–7 score |
| `src/lib/memo.ts` | Assembles all eight parts of `brian` §4. The screen renders it and decides nothing |
| `src/lib/extract.ts` | The report reader: a label table and arithmetic, sector-aware, no model |
| `src/lib/pdf.ts` | pdf.js, positioned text runs grouped back into table rows |
| `src/lib/xlsx.ts` | A spreadsheet reader with **no dependency** — the browser inflates the zip natively |
| `src/lib/private.ts` | The venture lens, the private equity lens, quality of earnings, the capital stack, the committee |
| `src/lib/calendar.ts` | Settlement, weekends, Kenya's holidays, the last day to buy cum-dividend |
| `src/lib/compare.ts` | Restating a multiple from one discount rate onto another |
| `src/lib/collected.ts` | Reads the collector's JSON from `/data`. Absence is normal, not an error |
| `src/lib/store.ts` | `localStorage`, defensively |
| `src/screens/` | Analyse, Private, Watchlist, Compare |
| `src/hooks/useModel.ts` | The model parameters — `r`, `g`, `k`, `n`, `c`, `w`, stress, hold floor |
| `src/hooks/useAppearance.ts` | Theme and font scale, `design.md` §16 |

### The Python side — the collector

Runs unattended on the VM, Monday to Saturday at 15:00 UTC, as a systemd
oneshot plus timer.

| File | What it holds |
|---|---|
| `collector/registry.py` | The contract for what may be held: every series names the decision it changes, its cadence, its retention and its **licence**. NSE series are `proprietary-private-use` and never published |
| `collector/nse.py` | Market summary and equity parsing |
| `collector/cbk.py` | Key rates off the CBK home page |
| `collector/store.py` | Plain JSON, one file per counter, atomic write, tiered retention — 400 trading days at full resolution, month-ends for ever. **32 MB peak, 986 KB on disk**, both measured |
| `collector/probe.py` | Hunts the equity feed endpoint systematically |
| `collector/alert.py` | Telegram, when configured. A failed run is otherwise silent |
| `kernel/*.py` | The same valuation maths as `src/lib/kernel.ts` |

**The kernel is implemented twice**, Python and TypeScript, and both are tested
against `fixtures/kernel-fixtures.json`. That single shared fixture file is what
stops them drifting: a change to one that is not made to the other fails the
suite.

### Fixtures — three, and two are generated

- `kernel-fixtures.json` — the 2016 UNGA and Liberty workbooks. Every expected
  value **computed by the implementation** and read for plausibility before
  being written down. Two hand-written ones were wrong early on.
- `statement-lines.json` — a statement as the readers hand it over.
- `statement.xlsx` and `statement.pdf` — generated from that file by
  `scripts/make-statement-*.py`. All three ingestion paths are held to one bar:
  from the file alone, reproduce the UNGA inputs to the shilling.
- `bank-statement-lines.json` — lines transcribed verbatim from the real I&M
  Group half-year statement. It reads 12 of 12.

---

## 4. THE VALUATION MODEL

This is Brian's own, from the 2017 workbooks. Do not substitute a textbook one.

```
future earnings  = FV(g, n, net profit from operations)
my future EPS    = PV(r, n, future earnings) / shares issued
my valuation     = (1 − k) × my future EPS
market's price
  of future      = entry price − PV(dividends per share) − cash per share
  earnings

BUY when my valuation ≥ market's price of future earnings
margin           = (my valuation − market's price) / my valuation
```

- `r` is the GoK bond yield at the tenor actually held to, carrying its auction
  date. A shilling rate prices shilling cash flows — a currency mismatch is
  warned about, never silently absorbed.
- `k` is the margin of safety, default 0.35.
- `c` loads the **entry price only**, never the valuation. A test asserts this.
- **HOLD** is a real third state, on a floor that is a parameter rather than a
  constant buried in the code.
- **Sector profiles** — industrial, insurer, bank, property, telco — change the
  fragility sheet. The Focus Model ratio (EBITA over net working capital
  against a 45% floor) is computed for industrials, property and telcos and
  **suppressed** where it would be a number that lies.

---

## 5. THINGS THAT COST A DAY TO LEARN

Every one of these was paid for. A new session should not pay again.

**On the reader.**
1. A bank has no current assets. It publishes TOTAL ASSETS and TOTAL
   LIABILITIES and stops, and numbers every row. Reading one with industrial
   labels finds 3 figures out of 12. The sector must be set before reading.
2. A dash standing alone in a table is a nil marker, not a minus sign.
   `DIVIDEND PER SHARE - (KSHS) - 3.75` pays 3.75.
3. Commas group thousands; a space never does. Allowing a space glues two table
   columns into one wrong number.
4. "Connecting millions of Kenyans" is not a units declaration. A declaration is
   short, or it sits beside a currency marker.
5. Real headers repeat their years — `JUN 2025 · DEC 2025 · MAR 2026 · JUN 2026`
   — run oldest first, and appear twice over when company and group sit side by
   side. Read the header as a sequence and infer its direction.
6. A line whose only number is its own note reference is a heading, not a figure.

**On deploying.**
7. `caddy validate` never touches the filesystem. A site block whose log file
   lived in an unwritable directory passed validation and then refused to start
   **every site on the machine**, taking gachichio.org down. There is no log
   file now; systemd journals access logs already.
8. Caddy substitutes `{$VAR}` when it *adapts* the config, and that value
   reaches it through systemd's `EnvironmentFile`. Validating without it reports
   a good config broken.
9. Never source a file containing a bcrypt hash: it contains `$2a$14$`, which
   the shell expands. Read the value literally.
10. A backup taken *after* the change carries the change. Take it before the
    first mutation, and strip the change from it either way.
11. A reload re-reads the Caddyfile but not the unit's `EnvironmentFile`. Use a
    restart when the environment changed.
12. Every command in a runbook belongs to a named machine. `caddy hash-password`
    runs on the VM; Caddy is not on the Lenovo.

**On verifying.**
13. **A green unit suite does not mean the app works.** 99 tests passed while the
    memo screen had silently dropped the entry price — the exact figure the
    transaction-cost slider exists to move.
14. **Test under the constraint production imposes.** The browser check served no
    content-security-policy while Caddy serves `script-src 'self'`, so it could
    not see that the inline theme script would be refused — silently losing the
    saved theme and font scale on every load.
15. **A listener removed is a check deleted.** A CSP refusal is reported to the
    console and nowhere else.
16. **Rehearse a deployment against stubs of the target's own commands.** Ten
    minutes stubbing `caddy` and `systemctl` — after seven failed attempts on
    the real machine, the next one worked first time. This is now Phase 4 of
    `processes/pre-deploy-package-audit.md`.
17. **Pushing is not shipping.** CI was red for two commits while the work was
    reported as done.

---

## 6. OPERATING IT

```sh
# Once per machine
npx playwright install chromium

# Once, for the VM — prompts for the site password there, idempotent
./setup-site.sh

# Every time — tests, builds, drives the app in a browser, ships, verifies
./deploy-app.sh

# The collector
./deploy.sh

# Alerts — the token is typed on the VM, never carried
./setup-telegram.sh

# If Caddy will not start: removes myAnalyst, restores the Caddyfile byte-identically
./rollback-site.sh
```

Build on the Lenovo. **The VM never builds.**

Local development:

```sh
npm run dev      # http://localhost:5173
npm test         # 107 TypeScript tests
npm run check    # build, then drive the built app in Chromium — 47 checks
python3 -m pytest -q
```

`npm run check` is the one that matters before shipping. `deploy-app.sh` runs it
and refuses to ship if it fails.

---

## 7. STYLE AND STANDARDS THIS BUILD IS HELD TO

From Brian's skills at `github.com/bgachichio/skills`:

- **`brian` §4** — the eight-part mandatory output, the four decision factors,
  the Bitcoin hurdle, the PE mental model.
- **`design.md`** — Material 3 tokens, Courier Prime for display and headline
  only, Inter for everything else, four font-size steps, Auto/Light/Dark, 44px
  touch floor, charts carrying a title, a unit, a direct label and a summary
  that doubles as the accessible description. `DESIGN-COMPLIANCE.md` holds the
  checklist and what verification found.
- **`developer.md`** — six gates. `GATES.md` holds the graded record.
- **`building`** — selection law, the memory law, the four PWA defaults,
  `DEPLOY.md` in nine sections with a tested rollback.
- **`audit`** — the spec is written before the draft, graded with evidence, and
  stamped. No stamp is not valid output.

**Prose law applies to everything written for Brian**: UK English, active voice,
no em dashes, cut every word that carries no load, lead with the insight.

---

## 8. WHAT TO DO NEXT, IN ORDER

1. **Capture the NSE feed's `action=` payload** from the browser Network tab.
   That is the only thing blocking Gap 1, and only Brian can do it.
2. **Build the counter picker** (Gap 2). Local, no VM needed, no dependency on
   Gap 1 landing.
3. **Build the anchor picker** (Gap 3) — a saved memo as the comparable, plus
   sector-matched counters as candidates.
4. **Prove one Telegram alert arrives**, then hold a restore drill.
5. **Rotate the site password** — an earlier hash reached a chat transcript:
   `ssh pulse 'sudo rm /etc/caddy/env'` then `./setup-site.sh`.

---

## 9. A NOTE ON HOW THIS SESSION WENT

The app was built and tested cleanly. **Every deployment failure was mine**, and
there were eight of them, one of which took Brian's live website down for about
an hour. The pattern was identical each time: I verified in the sandbox I was
standing in and wrote instructions for a machine I could not reach, while the
unit tests stayed green throughout and told me nothing about any of it.

The two durable assets that came out of it are
`processes/pre-deploy-package-audit.md` v1.1 (which now has a Rehearse phase)
and `processes/browser-verification.md`. A session continuing this work should
read both before touching anything that deploys.

Brian's stated preference, earned the hard way: **when something is failing
repeatedly, one tested command beats exploration.**
