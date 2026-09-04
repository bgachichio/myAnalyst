# DEPLOY.md - myAnalyst collector

## 1. WHAT THIS IS

A job that runs six mornings a week on the VM, Monday to Saturday. It scrapes
the day's closes off the NSE market statistics page and the key rates off the
CBK home page, stores them as JSON, prunes what has aged out, and writes the
index the app reads. **Nobody downloads or uploads anything: it is unattended.**

If it stops, every valuation falls back to a hand-typed price. The tool still
works; it just stops knowing today's number by itself.

**What stays manual, by design:** the documents you bring to a question — an
information memorandum, a deal sheet, an annual report — and the price of a
private or unlisted company, which no exchange publishes.

The PWA is the shell you open: it holds the valuation kernel and runs entirely
in the browser, offline. It is deployed separately, to Vercel, because it is
static and public. The collector's data never goes there.

## 2. PREREQUISITES

On the Lenovo (Zorin OS 18), where every build happens:

```sh
python3 --version        # 3.12 or newer. Note: python3, not python -
                         # Debian and its derivatives do not ship a bare `python`
node --version           # 22 or newer
ssh pulse 'echo ok'      # the VM, alias in ~/.ssh/config
```

**Zorin marks the system Python as externally managed (PEP 668), so a bare
`pip install` is refused, and rightly.** Everything goes in a project
virtualenv. Never `--break-system-packages`: the point of the rule is that a
build tool must not be able to damage the operating system.

On the VM (`deltabot-vm-za`, Debian 12, af-south1, 1 GB), once ever:

```sh
sudo adduser --system --group --home /home/myanalyst myanalyst
sudo apt-get update && sudo apt-get install -y python3-venv
sudo mkdir -p /opt/myanalyst/releases /var/lib/myanalyst /srv/myanalyst/private
sudo chown -R myanalyst:myanalyst /opt/myanalyst /var/lib/myanalyst /srv/myanalyst
```

**Never run `pip install` from source or `npm install` on the VM.** 1 GB of RAM
will OOM. The wheel is built on the Lenovo and shipped.

**Count before you add — `building` §3, rule 2.** The collector peaks at **32 MB
RSS** and **986 KB on disk**, measured against a store holding 26,001 closes.
It is a oneshot, so it adds no standing memory: the box carries a few seconds'
spike six days a week, not a sixth resident service. Check there is room for that
spike before the first deploy, and after anything else joins the box:

```sh
ssh pulse 'free -m; df -h /'
```

**Proceed only if `available` is at least 150 MB and the root filesystem has at
least 500 MB free.** Below that, the answer is not swap: it is moving the
collector to the Lenovo, or paying for an e2-small. Record the reading here:

| Date | Available RAM | Free disk | Decision |
|---|---|---|---|
| 2026-09-03 | 485 MB of 969 MB | 17 GB of 30 GB | **Proceed.** A 32 MB spike is 6.6% of available. |

**Noted at the same time: 309 MB of swap already in use.** Not a blocker, but it
means the box has been under memory pressure before now. `building` §3 rule 3 is
that swap is not headroom, so if a future reading shows available RAM falling
toward 150 MB, the answer is to move the collector to the Lenovo or move the box
to an e2-small - not to lean further on swap. `OOMScoreAdjust=800` means the
collector is what the kernel takes first if it ever comes to that.

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

Two steps, because only one of the five values is a secret.

**The paths are not secrets.** Write them straight in — nothing sensitive
reaches your shell history:

```sh
ssh pulse 'sudo install -d -o myanalyst -g myanalyst -m 700 /home/myanalyst/secrets
sudo tee /home/myanalyst/secrets/myanalyst.env >/dev/null <<EOF
MYANALYST_DB=/var/lib/myanalyst/store
MYANALYST_OUT=/srv/myanalyst/private
MYANALYST_WINDOW_DAYS=400
EOF
sudo chown myanalyst:myanalyst /home/myanalyst/secrets/myanalyst.env
sudo chmod 600 /home/myanalyst/secrets/myanalyst.env'
```

**The Telegram pair is a secret**, so it goes in through an editor and never
through a command line. `ssh` needs `-t` to give the editor a terminal —
without it you get `Error opening terminal: unknown`:

```sh
ssh -t pulse 'sudo nano /home/myanalyst/secrets/myanalyst.env'
```

Append `TELEGRAM_BOT_TOKEN=` and `TELEGRAM_CHAT_ID=` with their values. The
collector runs without them; it simply cannot tell you when it fails.

The collector needs no API key to read its two sources. The Telegram pair is
for alerts only, never a control plane, and without it a failed run is silent.

**Fire the alert once, on purpose, before you trust it** (`developer` §13):

```sh
ssh pulse 'sudo -u myanalyst env $(sudo cat /home/myanalyst/secrets/myanalyst.env | xargs) \
  /opt/myanalyst/current/.venv/bin/myanalyst-collect --test-alert'
```

Expect `test alert delivered` and a message on your phone. An alert nobody has
seen arrive is not an alert.

## 4. FIRST-RUN

Clean checkout to running locally:

```sh
git clone https://github.com/bgachichio/myAnalyst && cd myAnalyst

python3 -m venv .venv                      # PEP 668: never system-wide
.venv/bin/pip install -e ".[dev]" build
npm ci

.venv/bin/python -m pytest -q              # expect: 76 passed, 3 skipped
npm test                                   # expect: pass 9, fail 0

.venv/bin/myanalyst-collect --db ./store --out ./private --date 2026-09-04
.venv/bin/myanalyst-collect --db ./store --health
```

`deploy.sh` finds `.venv/bin/python` on its own, so once the virtualenv exists
you never have to think about it again.

The three skips are optional live-source tests. The parsers are covered by
tests built from the real page's structure; these extra ones only run if you
drop a saved copy of the NSE market statistics page, a price-list workbook, or
the CBK home page into `collector/fixtures/`. Worth doing once, to prove the
parsers against the real markup rather than a model of it. **Not required to
operate:** the collector scrapes unattended either way.

## 5. BUILD

**The collector:**

```sh
python -m build --wheel        # ~5 seconds, one file in dist/, under 60 KB
```

The artefact is a pure-Python wheel. Its dependencies (`httpx`, `openpyxl`)
install from manylinux wheels, so nothing compiles on the VM.

**The PWA:**

```sh
npm ci && npm test && npm run build && node scripts/browser-check.mjs
```

Type-checks, runs the browser kernel against the same fixtures as the Python
one, builds, then drives the built app in Chromium: both themes at 390px, the
touch floor, the collector's figures reaching the hurdle fields, a real PDF
pushed through the real file input, the transaction-cost slider moving the
entry price, and the watchlist surviving a reload. `deploy-app.sh` runs all of
it and refuses to ship if any step fails.

Expect `dist/` at roughly 850 KB precached: the shell plus the chart chunk that
loads only when there is a verdict to draw. pdf.js and its worker are 1.7 MB
between them and stay out of the precache, cached instead the first time a PDF
is read — most sessions never open one. Fonts are self-hosted; nothing is
fetched from a CDN at runtime.

## 6. DEPLOY

**The PWA — analyst.gachichio.org, on the VM.**

Not Vercel. The app and the collector's data are served from the **same
origin**, which solves two things at once: a browser cannot read nse.co.ke
cross-origin, and NSE data must not sit on a public CDN. One hostname, one
password, both problems gone.

*Once, before the first app deploy.* Four steps, and every command that needs
Caddy runs **on the VM**, because Caddy is installed there and not on the
Lenovo. Do not install Caddy locally to run one command.

```sh
# 1. DNS: an A record for analyst -> the VM's address (34.35.177.164),
#    at your registrar. Confirm before going further:
dig +short analyst.gachichio.org          # must print 34.35.177.164

# 2. The password. Choose it, then hash it ON THE VM. The hash goes in a file
#    the web server reads; the password itself goes in your manager and into
#    the shell you deploy from. `ssh -t` because it prompts.
ssh -t pulse 'caddy hash-password'        # type the password twice, copy the hash

# 3. The site. Append the block, give Caddy the hash, create the app directory.
scp deploy/Caddyfile.analyst pulse:/tmp/
ssh -t pulse 'set -e
  sudo install -d -o myanalyst -g myanalyst -m 755 /srv/myanalyst/app
  sudo touch /etc/caddy/Caddyfile
  grep -q analyst.gachichio.org /etc/caddy/Caddyfile ||
    sudo tee -a /etc/caddy/Caddyfile < /tmp/Caddyfile.analyst >/dev/null
  rm -f /tmp/Caddyfile.analyst
  read -rp "paste the hash: " H
  printf "MYANALYST_PASSWORD_HASH=%s\n" "$H" | sudo tee /etc/caddy/env >/dev/null
  sudo chmod 600 /etc/caddy/env
  sudo chown root:root /etc/caddy/env'

# 4. Let the service read that file, then reload.
ssh pulse 'sudo systemctl edit --full caddy'   # add: EnvironmentFile=/etc/caddy/env
ssh pulse 'sudo caddy validate --config /etc/caddy/Caddyfile &&
           sudo systemctl reload caddy'
```

*Every time after that:*

```sh
# The password is only needed so the deploy can verify the site answers. Read
# it in rather than typing it on the command line, so it never reaches history.
read -rs MYANALYST_PASSWORD && export MYANALYST_PASSWORD

./deploy-app.sh      # builds here, ships dist/, validates Caddy, reloads, verifies
```

`deploy-app.sh` checks all of this before it builds anything: the password is
set, the VM answers without a prompt, and the site is in the Caddyfile. A
missing precondition stops it in two seconds rather than after the swap.

**Once, on the machine you deploy from:** the browser check needs a browser.

```sh
npx playwright install chromium           # about 150 MB, once per machine
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

The timer fires Monday to Saturday at 15:00 UTC, which is 18:00 in Nairobi,
after the close and after the day's figures are published, with up to ten
minutes of random delay so the NSE is not hit by a clock. Sunday is skipped.

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
curl -fsS -o /dev/null -w "%{http_code}\n" -u brian https://analyst.gachichio.org/   # expect 200
curl -fsS -o /dev/null -w "%{http_code}\n"    https://analyst.gachichio.org/         # expect 401
```

The second one matters as much as the first: an unauthenticated request must be
refused, because the data behind it is not ours to publish.

Then open it on the handset: install it, turn on aeroplane mode, and confirm it
still opens and still reaches a verdict. An installable app that needs the
network is not offline-capable.

**The collector:**

```sh
ssh pulse 'sudo -u myanalyst /opt/myanalyst/current/.venv/bin/myanalyst-collect \
  --health --db /var/lib/myanalyst/store'
```

Run it as the service user: the store belongs to `myanalyst`, and your login
user cannot read it.

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

**The PWA:** the previous copy is kept beside the live one, so it is a rename.

```sh
ssh pulse 'sudo rm -rf /srv/myanalyst/app && sudo mv /srv/myanalyst/app.old /srv/myanalyst/app && sudo systemctl reload caddy'
```

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
| A bad day was stored | Wrong prices for one date | The store is plain JSON, one file per counter, so fix it with the tools you already have: `sudo -u myanalyst sh -c 'cd /var/lib/myanalyst/store/prices/daily && for f in *.json; do python3 -c "import json,sys;p=sys.argv[1];r=[x for x in json.load(open(p)) if x[\"d\"]!=sys.argv[2]];json.dump(r,open(p,\"w\"))" "$f" "<date>"; done'` then re-run with `--date <date>`. |
| Disk filling | The VM is at 1 GB | It should not: the whole store is about 1 MB. If it is, `myanalyst-collect --prune-only` and read the line it prints. Something is writing outside the retention rule. |
