# Gate record — myAnalyst, 4 September 2026 (deployed)

Run against `building` v2.0, `developer` v1.0, `design` v1.1 and `audit` v1.0.
Evidence is a command that was run, not a claim. Where something has never been
executed, it says so.

---

## The acceptance gate (`audit` v1.0)

### Gate 0 — the contract

**Stated.** Build the app: the full memo (ii), private deals (iii), the
calendar and comparables (iv and v). Deterministic and confirmable, not waiting
on a language model. Withholding at 5%. NSE charges as a slider, 0% to 10%.
Ignore NASDAQ and DJIA. Scrape rather than upload. Serve at
analyst.gachichio.org.

**Implied.** `brian` §4's eight mandatory parts including the explicit bitcoin
comparison; §9's four PWA defaults, DEPLOY.md and a tested rollback; `design`
in full; `developer`'s six gates.

**Assumed, and declared rather than smuggled.**
1. The exit multiple equals the entry multiple. Printed on the memo as a
   statement of what has to hold, not a forecast.
2. Bitcoin's forward return cannot be forecast, so it is a rate the user sets
   and the memo prints beside every comparison.
3. Cross-border peer *discovery* is out of scope; cross-border *comparison* of
   companies Brian has analysed is in. The Compare screen says so on itself.

### Gate 1 — the spec

**Task.** Ship myAnalyst as a working app covering Brian's five goals,
deterministic, deployable to analyst.gachichio.org.

**Artefact.** The repository at `main`, plus DEPLOY.md and this record.

**Done means — five binary criteria.**

1. From a real PDF and a real spreadsheet alone, the app reaches all twelve
   figures at the correct scale and produces a verdict, verified in a browser
   rather than asserted.
2. Every one of `brian` §4's eight parts appears in the memo, the bitcoin
   comparison among them.
3. A private deal is assessed by both lenses and the disagreement is printed,
   not averaged.
4. The dividend deadline is derived from the books-closure date through NSE
   settlement and Kenya's holidays, with the arithmetic stated on screen.
5. No verdict is computed by a language model, and no shipped dependency
   carries a known advisory.

**Out of scope.** Scraping the JSE for peers. A journal screen. A model
gateway.

**Kill condition.** A figure reaching a verdict without the reader being able
to see where it came from.

### Gate 3 — the grade

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Twelve figures off a real file, right scale, in a browser | **PASS** | `node scripts/browser-check.mjs`: "the reader finds all twelve figures in the PDF — 12 of 12", "every figure cites the page it came from — 12 citations", "total income arrived at full scale — 19864152000". The same bar in CI without a browser: `tests/pdf.test.mjs`, `tests/xlsx.test.mjs`, `tests/extract.test.mjs` each reproduce the UNGA inputs from their own file |
| 2 | All eight parts, bitcoin included | **PASS** | `src/components/MemoView.tsx` carries (i) base and worst with assumptions, (ii)-(iv) the three trends, (v) the deal, (vi) the levers, (vii) the 0-7 score, (viii) the verdict with bullets. `tests/memo.test.mjs` asserts each, including "bitcoin is compared explicitly and the assumption is carried with it" and that it never overturns the verdict |
| 3 | Two lenses, disagreement printed | **PASS** | `tests/private.test.mjs` "the two lenses are allowed to disagree, and the disagreement is the finding". Browser: "the worked deal is the case the screen exists for — HOLD", "the disagreement between the lenses is printed, not averaged — 1 statement" |
| 4 | The deadline, derived and stated | **PASS** | `tests/calendar.test.mjs`, 14 tests, every date checked against a calendar before it was written down. Browser: "The register closes on 2030-06-04. The NSE settles 3 trading days after the trade, so the last day to buy and still be on it is 2030-05-30" |
| 5 | No model, no advisory | **PASS** | `grep -rniE "openai\|anthropic\|gemini\|litellm\|api[_-]?key" src/` returns nothing. `npm audit`: **0 vulnerabilities**, after upgrading vite 5→8, plugin-react 4→6 and vite-plugin-pwa 0.21→1.3 to clear three dev-server advisories |

**Excess test.** Nothing out of scope shipped. The Journal placeholder was
**deleted**: it promised a screen nothing was building.

**Kill test.** Did not fire. Every extracted figure carries its source line,
page and confidence; every memo figure carries the parameters that produced it;
every restated multiple prints its own arithmetic.

`Audit · 5/5 · rebuilds 0 · defect none`

---

## building

| § | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Selection law, all five | PASS | Every dependency OSI-licensed, free at this volume, small, offline-capable, replaceable. The spreadsheet reader is **no dependency at all**: the obvious library carries a published advisory in the version npm serves and the fixed build lives outside the registry, so `src/lib/xlsx.ts` reads the zip with the browser's own `DecompressionStream` |
| 2 | Canonical stack | PASS, one deviation | React + Vite + Tailwind v4 + lucide + recharts + vite-plugin-pwa; Python 3.11; data at rung 0, plain JSON. **Deviation: `pip`, not `uv`** — none in this environment; the pinned manifest gives the same determinism |
| 3 | Memory law | PASS | Collector peak measured at **32 MB**, store 986 KB, against a VM reporting 485 MB available |
| 5 | Local-first | PASS | The whole analysis runs in the browser. Reports are read on the device and never uploaded. The only server is the collector, and only because a browser cannot fetch either source cross-origin |
| 6 | The four defaults | PASS | Four font steps (`SCALES`), Auto/Light/Dark (`THEMES`), settings one tap away and stored in `localStorage`, installable PWA with an offline shell. No-FOUC script in `index.html`. Both themes verified in Chromium at 390px |
| 8 | DEPLOY.md, nine sections | PASS | All nine. The rollback is still marked untested |
| 9 | Banned list | PASS | No MUI, no chart.js, no CDN fonts, no Kubernetes, no `latest` tags, no `curl \| bash`, no long-lived keys, no build on the VM |

---

## developer — the six gates

| Gate | Verdict | Evidence |
|---|---|---|
| **G0 Secrets** | **PASS** | No credential in any file. A test asserts the Telegram token can never reach a log line |
| **G1 Necessity** | **PASS** | Three Questions in the build brief §4. One deletion this round: the Journal placeholder |
| **G2 Code integrity** | **PASS** | **202 tests**: 103 Python over the kernel, store, registry and adapters; 99 TypeScript over the kernel, the memo, the reader, the private deal, the calendar and the comparison. Two implementations of the kernel held to one fixture file so they cannot drift. Plus **37 browser checks** on the built app |
| **G3 Supply chain** | **PASS** | Python dependencies pinned exactly; `package-lock.json` committed; **0 npm advisories** at any level, production and development, after the vite upgrade; 0 Python advisories. `pdfjs-dist` pinned to 5.5.207 because version 6 declares support for Node 22 and then calls `Promise.try`, which Node 22 does not have |
| **G4 Runtime & deploy** | **PASS**, and the rollback is now proven | Non-root service user, no capabilities, atomic directory swap, never builds on the VM. `deploy-app.sh` runs the unit tests and the browser check before anything ships, and refuses to start without its preconditions. **The rollback has been executed in anger**: the site block took Caddy down, `rollback-site.sh` removed it and brought Caddy back, and the app deployed cleanly afterwards. `https://analyst.gachichio.org/ -> 200` |
| **G5 Observability** | **PARTIAL** | journald plus a collection log; alerts fire on a refused source, an unparseable page, an unexpected error, and a store that has stopped advancing. **The alert has never been delivered and there has been no restore drill** |

---

## design

`DESIGN-COMPLIANCE.md` has the checklist. **PASS**, verified in headless
Chromium at 390×844 in both themes: the touch floor on every control (screen
-reader-only controls excluded, because measuring a clip measures the clip),
no horizontal overflow on any screen, theme tokens applied, no console errors,
every chart carrying a title, a unit, a direct label and a summary that doubles
as its accessible description.

---

## The deployment, and the outage it caused

The app is live at **https://analyst.gachichio.org**, behind basic auth, on the
same origin as the collector's data. `deploy-app.sh` verified it: **200**.

Getting there took seven attempts and caused an outage of gachichio.org. Every
failure was in the deployment path, none in the app, and all of them were mine:

| # | What failed | Why |
|---|---|---|
| 1 | The browser check would not start | It hardcoded a Chromium path that exists only in the sandbox it was written in |
| 2 | The theme would have been dead in production | The no-FOUC script was inline under `script-src 'self'`. Found only after the check was made to serve the real policy |
| 3 | `caddy hash-password` "not found" | The runbook told him to run it locally; Caddy is on the VM |
| 4 | A blank password reached the deploy | Two lines that, pasted together, let `read` swallow an empty one |
| 5 | `caddy validate` rejected a valid config | It substitutes `{$VAR}` at adapt time, and only systemd holds the value |
| 6 | Sourcing the env file aborted | A bcrypt hash contains `$2a$14$`, which the shell expands |
| 7 | **Caddy would not start, taking gachichio.org down** | The site block wrote an access log to a file. `caddy validate` never touches the filesystem, so it passed and then refused to start the whole server |
| 8 | The rollback restored the fault | The backup was first taken *after* the block had been appended, so it carried the thing it was meant to undo |

Both are fixed at the root rather than worked around: there is no log file at
all now (systemd already journals access logs), and the rollback strips the
block whether or not it restores a backup, then cleans the backup too.

**The lesson, once, plainly.** Every one of these came from verifying in the
environment I was standing in and writing instructions for a machine I cannot
reach. The unit tests and the browser checks were green throughout and told me
nothing about any of it.

## What is still not true

1. **No adapter has ever made a live call to nse.co.ke or centralbank.go.ke.**
   The equity feed is client-rendered and its endpoint is still unknown;
   `myanalyst-probe` exists to find it and has never been run. Three index
   levels do collect.
2. **The collector is not redeployed since `probe.py` was added**, so
   `myanalyst-probe` is not on the VM yet. `./deploy.sh` puts it there.
3. **The alert has never been delivered, and no restore drill has been held.**
   No Telegram channel is configured, so a failed collection is currently
   silent.
4. **The site password hash was pasted into a chat transcript.** It is a bcrypt
   hash rather than a password, but it is brute-forceable offline. Rotate it:
   `ssh pulse 'sudo rm /etc/caddy/env'` then `./setup-site.sh`.
