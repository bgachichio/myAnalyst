# DEPLOY.md - myAnalyst collector

## 1. WHAT THIS IS

A once-a-weekday job on the VM that downloads the NSE daily equity price list
and the CBK key rates, stores them, prunes old rows, and writes the JSON the app
reads. **If it stops, every valuation falls back to a hand-typed price.** The
tool still works; it just stops knowing today's number by itself.

The PWA is the shell you open: it holds the valuation kernel and runs entirely
in the browser, offline. It is deployed separately, to Vercel, because it is
static and public. The collector's data never goes there.

## 2. PREREQUISITES

On the Lenovo (Zorin OS 18), where every build happens:

```sh
python3 --version        # 3.12 or newer
node --version           # 22 or newer
pip install build        # the wheel builder
ssh pulse 'echo ok'      # the VM, alias in ~/.ssh/config
```

On the VM (`deltabot-vm-za`, Debian 12, af-south1, 1 GB), once ever:

```sh
sudo adduser --system --group --home /home/myanalyst myanalyst
sudo apt-get update && sudo apt-get install -y python3-venv
sudo mkdir -p /opt/myanalyst/releases /var/lib/myanalyst /srv/myanalyst/private
sudo chown -R myanalyst:myanalyst /opt/myanalyst /var/lib/myanalyst /srv/myanalyst
```

**Never run `pip install` from source or `npm install` on the VM.** 1 GB of RAM
will OOM. The wheel is built on the Lenovo and shipped.

**Count before you add — `building` §3, rule 2.** The collector peaks at **132 MB
RSS** on a realistic daily run, measured against a store holding 26,001 closes.
It is a oneshot, so it adds no standing memory: the box carries a ten-second
spike once a weekday, not a sixth resident service. Check there is room for that
spike before the first deploy, and after anything else joins the box:

```sh
ssh pulse 'free -m; df -h /'
```

**Proceed only if `available` is at least 300 MB and the root filesystem has at
least 1 GB free.** Below that, the answer is not swap: it is moving the
collector to the Lenovo, or paying for an e2-small. Record the reading here:

| Date | Available RAM | Free disk | Decision |
|---|---|---|---|
| _not yet taken_ | | | |

## 3. SECRETS

Names only. No values in this document, ever.

| Name | What it is | Where it comes from | Where it lives |
|---|---|---|---|
| `MYANALYST_DB` | Path to the DuckDB store | You choose it | `~/secrets/myanalyst.env` on the VM, mode 600 |
| `MYANALYST_OUT` | Where the private JSON is written | `/srv/myanalyst/private` | same file |
| `MYANALYST_WINDOW_DAYS` | Trading days of daily history kept | Default 400 | same file |
| `TELEGRAM_BOT_TOKEN` | Alert channel for failures | BotFather | same file |
| `TELEGRAM_CHAT_ID` | Your chat | Telegram | same file |

The service runs as the `myanalyst` user and systemd reads this file as root
before the sandbox applies, so it lives in the **service user's** home, not
yours:

```sh
ssh pulse 'sudo install -d -o myanalyst -g myanalyst -m 700 /home/myanalyst/secrets'
ssh pulse 'sudo install -o myanalyst -g myanalyst -m 600 /dev/null /home/myanalyst/secrets/myanalyst.env'
ssh pulse 'sudo ${EDITOR:-nano} /home/myanalyst/secrets/myanalyst.env'
```

The collector needs no API key to read its two sources. The Telegram pair is
for alerts only, never a control plane, and without it a failed run is silent.

**Fire the alert once, on purpose, before you trust it** (`developer` §13):

```sh
ssh pulse 'set -a; . ~/secrets/myanalyst.env; set +a;
  /opt/myanalyst/current/.venv/bin/myanalyst-collect --test-alert'
```

Expect `test alert delivered` and a message on your phone. An alert nobody has
seen arrive is not an alert.

## 4. FIRST-RUN

Clean checkout to running locally:

```sh
git clone https://github.com/bgachichio/myAnalyst && cd myAnalyst
pip install -e ".[dev]"
npm install
python -m pytest -q     # expect: 66 passed, 3 skipped
npm test                # expect: pass 9, fail 0
myanalyst-collect --db ./prices.duckdb --out ./private --date 2026-09-02
myanalyst-collect --db ./prices.duckdb --health
```

The three skips are the live-source tests. They stay skipped until a saved copy
of the NSE market statistics page, a real price-list workbook, and the CBK home
page are dropped into `collector/fixtures/`. **Do that before the first real
run**: it is the only proof the parsers match the live pages.

## 5. BUILD

**The collector:**

```sh
python -m build --wheel        # ~5 seconds, one file in dist/, under 60 KB
```

The artefact is a pure-Python wheel. Its dependencies (`duckdb`, `httpx`,
`openpyxl`) install from manylinux wheels, so nothing compiles on the VM.

**The PWA:**

```sh
npm ci && npm run build        # ~6 seconds
```

Type-checks first, then builds. Expect `dist/` at roughly 790 KB precached: a
164 KB shell (53 KB gzipped) plus a 374 KB chart chunk that loads only on the
Analyse screen. Fonts are self-hosted; nothing is fetched from a CDN at runtime.

## 6. DEPLOY

**The PWA — Vercel, `building` §8.2 Path A:**

```sh
npm ci && npm run build && npm run preview   # check http://localhost:4173 first
npx vercel                                   # preview URL, open it
npx vercel --prod                            # promote
```

Build on the Lenovo. Never on the VM.

**The collector — the VM:**

```sh
./deploy.sh                    # under 90 seconds
```

Which does, in order: runs both test suites locally and stops on failure; builds
the wheel; creates `/opt/myanalyst/releases/<timestamp>-<sha>` on the VM;
installs it into its own venv with `--only-binary :all:`; installs the systemd
unit and timer; swaps the `current` symlink atomically with `mv -Tf`; enables the
timer; runs the health check; **rolls back automatically if the health check
fails**; and keeps the last three releases.

The timer fires Monday to Friday at 15:00 UTC, which is 18:00 in Nairobi, after
the close and after the price list is published, with up to ten minutes of
random delay so the NSE is not hit by a clock.

## 6a. ISOLATION - WHAT THIS SHARES WITH THE WEBSITE AND KENYA PULSE

Nothing, by construction. The box runs other services; this one is built to lose
every contest with them.

**It owns four paths and touches nothing else.**

| Path | What |
|---|---|
| `/opt/myanalyst/` | Releases and the `current` symlink |
| `/var/lib/myanalyst/` | The DuckDB store |
| `/srv/myanalyst/private/` | Emitted JSON. Named `private` because NSE data must never be served |
| `/etc/systemd/system/myanalyst-collect.{service,timer}` | The unit and its schedule |

**It cannot reach anything else, and this is enforced rather than intended.**
`ProtectSystem=strict` makes the entire filesystem read-only except the two
`ReadWritePaths`. `ProtectHome=true` makes `/home` invisible, so it cannot read
Kenya Pulse's files or yours. `PrivateTmp=true` gives it its own `/tmp`, so it
cannot collide with another service's temporary files. `ProtectProc=invisible`
hides other processes from it.

**It listens on no port.** It is a `oneshot` that makes outbound HTTPS requests
and exits. There is no socket to conflict with Caddy, no port to clash with
Kenya Pulse, and nothing to add to a reverse-proxy config. **Do not point Caddy
at `/srv/myanalyst/private`** - that would publish NSE data and break the
licence position in `LICENCE-NOTES.md`.

**It yields under pressure.** On 1 GB, a background job must never be the reason
a web service dies. `MemoryHigh=128M` throttles it before `MemoryMax=256M` kills
it; `CPUQuota=40%`, `CPUWeight=20`, `IOWeight=20` and `Nice=10` put it last in
every queue; and `OOMScoreAdjust=800` makes the kernel pick it first if memory
runs out. It has no capabilities, no new privileges, and a `@system-service`
syscall filter.

**It shares the operating system and the package manager.** That is the one real
coupling: a distribution upgrade affects both. It installs no system packages of
its own - each release carries its own virtualenv - and only two releases are
kept, since each holds a copy of its dependencies.

Prove all of it on the box:

```sh
./scripts/verify-isolation.sh          # run against the VM after deploying
```

## 7. VERIFY

**The PWA:**

```sh
curl -fsS -o /dev/null -w "%{http_code}\n" https://<app>.vercel.app   # expect 200
```

Then open it on the handset: install it, turn on aeroplane mode, and confirm it
still opens and still reaches a verdict. An installable app that needs the
network is not offline-capable.

**The collector:**

```sh
ssh pulse '/opt/myanalyst/current/.venv/bin/myanalyst-collect --health --db /var/lib/myanalyst/prices.duckdb'
```

The collector alerts on its own failures: a refused source, a price list that
will not parse, an unexpected error, and a store that has stopped advancing.
Prices are never discarded because the key rates failed, and a parse failure
stores nothing rather than half a day.

Success is exactly this, and exit code 0:

```
last close 2026-09-02 (1 days old) · 64 counters · 3 rate observations · 0 failures in 7 days
HEALTH OK
```

Exit code 1 with `HEALTH FAIL` means the newest close is more than four days old
or the store is empty. The process having run is not success; a recent good day
of prices is.

```sh
ssh pulse 'systemctl list-timers myanalyst-collect.timer'   # next fire time
ssh pulse 'journalctl -u myanalyst-collect -n 50 --no-pager'
```

## 8. ROLLBACK

**The PWA:** `npx vercel rollback` — instant, no rebuild, previous deployment.

**The collector:**

```sh
./rollback.sh
```

Symlink swap to the previous release, timer restart, health check. No rebuild.
Under 60 seconds.

**Last tested: never.** This has not been run against the VM, because the
session that wrote it had no network route to it. **Run it once, deliberately,
immediately after the first successful deploy**, and write the date here. Until
then it is a rumour, and `building` §8.5 says an untested rollback is a refusal
condition.

## 9. TROUBLESHOOTING

| Failure | What you see | Fix |
|---|---|---|
| NSE layout changed | `parse-failed` in the log, nothing stored | Save the new page into `collector/fixtures/`, run the skipped tests, widen the header lists in `collector/nse.py`. The store is untouched, so there is no bad data to undo. |
| CBK layout changed | `rates-failed`, prices still stored | Same, in `collector/cbk.py`. Prices are deliberately not lost to a rates failure. |
| Health fails on a Monday | `newest close is 5 days old` | A Friday public holiday plus a weekend crosses the four-day limit. Confirm with `journalctl`, then raise `--stale-after` for that week rather than silencing the check. |
| A bad day was stored | Wrong prices for one date | `duckdb /var/lib/myanalyst/prices.duckdb "DELETE FROM daily_prices WHERE trade_date = DATE '<date>'"` then re-run with `--date <date>`. |
| Disk filling | The VM is at 1 GB | It should not: twenty years of everything is about 2 MB. If it is, `myanalyst-collect --prune-only` and read the line it prints. Something is writing outside the retention rule. |
