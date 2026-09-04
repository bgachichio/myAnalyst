# Gate record — myAnalyst, 3 September 2026

Run against `building` v2.0, `developer` v1.0, `design` v1.1 and `audit` v1.0 on
commit `a2bc541` and the two fixes above it. Evidence is a command that was run,
not a claim.

---

## building

| § | Requirement | Verdict | Evidence |
|---|---|---|---|
| 0 | Preflight before any code | PASS | Both blocks printed before the PWA was scaffolded |
| 1 | Selection law, all five | PASS | Every dependency OSI-licensed, free at this volume, small, runs offline, replaceable |
| 2 | Canonical stack | PASS with one deviation | React + Vite + Tailwind v4 + lucide + recharts + vite-plugin-pwa; Python 3.12; DuckDB at rung 1. **Deviation: `pip`, not `uv`.** No `uv` in this environment; the pinned manifest gives the same determinism |
| 3 | Memory law | **FAIL — one precondition cannot be met here** | Peak measured at **132 MB** on a realistic daily run. `MemoryHigh` was 128M, below the peak, and is now 192M. But §3 rule 2 requires `free -m` on the VM before adding a workload, and this session has no route to it. Recorded in DEPLOY.md §2 as a blocking pre-deploy check with a 300 MB threshold |
| 5 | Local-first default shape | PASS | The PWA holds the kernel and runs offline with no back end. The only server is the collector, and only because a browser cannot fetch either source cross-origin |
| 6 | The four defaults | PASS | Verified in a browser: both toggles apply live, persist, survive reload, no flash |
| 7 | Standard project | PASS with one stated omission | README, DEPLOY.md, .env.example, .pre-commit-config.yaml, src/, gate.yml all present. **No `compose.yaml`**: there is no stack to stand up. The app is `npm run dev` and the collector is a CLI against a local file. A compose file here would be scaffolding, and the Load-Bearing test deletes it |
| 8 | DEPLOY.md, nine sections | PASS | All nine, both artefacts, with the rollback marked untested |
| 9 | Banned list | PASS | No MUI, no chart.js, no CDN font tags, no Kubernetes, no `latest` tags, no `curl \| bash`, no long-lived keys, no build on the VM |

---

## developer — the six gates

| Gate | Verdict | Evidence |
|---|---|---|
| **G0 Secrets & identity** | **PASS** | `gitleaks git .` over the whole history: 8 commits scanned, no leaks. No credential in any file. A test asserts the Telegram token can never reach a log line |
| **G1 Necessity & design** | **PASS** | Three Questions answered in the brief §4. Delta-4 scored against the 2017 workbooks, which cannot watch a dividend calendar |
| **G2 Code integrity** | **PASS** | 73 tests over the money and data paths: 6 kernel, 10 price provenance, 11 store and retention, 10 registry and licence, 12 NSE parsing, 7 CBK parsing, 4 alerting, 9 TypeScript. Two implementations of the kernel held to one fixture file so they cannot drift. No dead exports |
| **G3 Supply chain** | **PASS**, after a fix | Was an auto-fail: Python dependencies were floors (`>=`) with no lockfile. Now pinned exactly. `package-lock.json` committed, every GitHub Action pinned to a 40-character SHA, 0 npm production advisories, 0 Python advisories |
| **G4 Runtime & deploy** | **PASS**, one item unproven | Non-root service user, no capabilities, health check that passes only on recent good data, atomic symlink swap, self-rollback on health failure, never builds on the VM. **The rollback has never been executed** — DEPLOY.md §8 says so rather than implying otherwise |
| **G5 Observability & recovery** | **PARTIAL** | journald plus a `collection_log` table; alerts now fire on a refused source, an unparseable page, an unexpected error, and a store that has stopped advancing. **The alert has never been delivered** and there has been **no restore drill**. `--test-alert` exists precisely to close the first on the box |

---

## design

Full checklist and what verification found: `DESIGN-COMPLIANCE.md`. **PASS**,
verified in headless Chromium at 390×900 and 1280×900, in both themes and at
every font scale. Three defects were found by looking and fixed before the
grade: page-wide horizontal overflow from an `sr-only` table, a duplicated
settings entry point on mobile, and a settings sheet that could not be opened
at all.

---

## What is still not true

Three things, none of which a document can fix:

1. **No adapter has ever made a live call.** Three tests stay skipped until a
   saved NSE page, a real price-list workbook and the CBK home page are dropped
   into `collector/fixtures/`.
2. **The rollback has never been run.**
3. **The alert has never been delivered, and no restore drill has been held.**

The first is the blocker. The other two are single commands on the box, and
DEPLOY.md names both.
