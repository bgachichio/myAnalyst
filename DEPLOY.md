# DEPLOY.md - myAnalyst collector

## 1. WHAT THIS IS

A once-a-weekday job on the VM that downloads the NSE daily equity price list
and the CBK key rates, stores them, prunes old rows, and writes the JSON the app
reads. **If it stops, every valuation falls back to a hand-typed price.** The
tool still works; it just stops knowing today's number by itself.

The PWA is not deployed by this document. When milestone 3 lands it goes to
Vercel by `building` §8.2 Path A, and this document gains a second half.

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

## 3. SECRETS

Names only. No values in this document, ever.

| Name | What it is | Where it comes from | Where it lives |
|---|---|---|---|
| `MYANALYST_DB` | Path to the DuckDB store | You choose it | `~/secrets/myanalyst.env` on the VM, mode 600 |
| `MYANALYST_OUT` | Where the private JSON is written | You choose it | same file |
| `MYANALYST_WINDOW_DAYS` | Trading days of daily history kept | Default 400 | same file |
| `TELEGRAM_BOT_TOKEN` | Alert channel, milestone 7 | BotFather | same file, not yet used |
| `TELEGRAM_CHAT_ID` | Your chat | Telegram | same file, not yet used |

```sh
ssh pulse 'install -m 600 /dev/null ~/secrets/myanalyst.env && ${EDITOR:-nano} ~/secrets/myanalyst.env'
```

The collector needs no API key. It reads two public pages.

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

```sh
python -m build --wheel        # ~5 seconds, one file in dist/, under 60 KB
```

The artefact is a pure-Python wheel. Its dependencies (`duckdb`, `httpx`,
`openpyxl`) install from manylinux wheels, so nothing compiles on the VM.

## 6. DEPLOY

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

## 7. VERIFY

```sh
ssh pulse '/opt/myanalyst/current/.venv/bin/myanalyst-collect --health --db /var/lib/myanalyst/prices.duckdb'
```

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
