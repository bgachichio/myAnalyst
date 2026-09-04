#!/usr/bin/env bash
# Configure analyst.gachichio.org on the VM. Runs as root, on the VM, once.
#
# Idempotent: every step checks whether it has already been done, so re-running
# it after a failure is safe and changes nothing that is already right.
#
# Paths are variables so the logic can be exercised off the VM without root.
set -euo pipefail

SITE="analyst.gachichio.org"
ETC_CADDY="${ETC_CADDY:-/etc/caddy}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
SRV="${SRV:-/srv/myanalyst}"
INCOMING="${INCOMING:-/tmp/Caddyfile.analyst}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
OWNER="${OWNER:-myanalyst}"

fail() { echo "!! $*" >&2; exit 1; }

# Read the hash out of the env file without executing the file. A bcrypt hash
# contains $2a$14$..., so sourcing it makes the shell expand $2 and $14 - which
# under `set -u` aborts, and without it silently mangles the hash. Quotes are
# stripped if present, so a file written by an older version still reads.
read_hash() {
  local line
  line="$(grep -m1 '^MYANALYST_PASSWORD_HASH=' "$ETC_CADDY/env" 2>/dev/null)" || return 1
  line="${line#MYANALYST_PASSWORD_HASH=}"
  line="${line%\'}"; line="${line#\'}"
  line="${line%\"}"; line="${line#\"}"
  [ -n "$line" ] || return 1
  printf '%s' "$line"
}

command -v caddy >/dev/null 2>&1 || fail "caddy is not installed on this machine."
[ -f "$INCOMING" ] || fail "$INCOMING is missing; setup-site.sh should have copied it."

if id -u "$OWNER" >/dev/null 2>&1; then
  install -d -o "$OWNER" -g "$OWNER" -m 755 "$SRV/app" "$SRV/private"
else
  # The collector has not been deployed yet. The app does not need that user to
  # exist, so create the directories and let deploy.sh sort the ownership out.
  install -d -m 755 "$SRV/app" "$SRV/private"
  echo "    note: no '$OWNER' user yet, so the directories are root-owned for now"
fi
echo "    $SRV/app and $SRV/private exist"

mkdir -p "$ETC_CADDY"
touch "$ETC_CADDY/Caddyfile"

# Back up before appending anything, once. This file is what rollback-site.sh
# restores, and it is the difference between "myAnalyst did not deploy" and
# "the web server is down and nobody remembers what was in the config".
BACKUP="$ETC_CADDY/Caddyfile.pre-myanalyst"
STRIPPER="${STRIPPER:-/tmp/caddyfile-block.py}"
if [ ! -f "$BACKUP" ]; then
  cp "$ETC_CADDY/Caddyfile" "$BACKUP"
  # The backup must be the config WITHOUT myAnalyst, whatever the live file
  # holds when it is taken. Taking it after a previous run had appended the
  # block made the rollback restore the very thing it was undoing.
  python3 "$STRIPPER" "$BACKUP" >/dev/null
  echo "    backed up the Caddyfile to $BACKUP, without any myAnalyst block"
fi

if grep -q "$SITE" "$ETC_CADDY/Caddyfile"; then
  echo "    the site block is already in the Caddyfile, leaving it alone"
else
  cat "$INCOMING" >> "$ETC_CADDY/Caddyfile"
  echo "    site block appended to the Caddyfile"
fi

if [ -s "$ETC_CADDY/env" ] && [ "$(read_hash 2>/dev/null | cut -c1-2)" = '$2' ]; then
  echo "    the password is already set; delete $ETC_CADDY/env to change it"
else
  echo
  echo "    Set the site password. Nothing echoes as you type, not even dots."
  HASH="$(caddy hash-password)"
  # Caddy prints its prompts to stderr and the hash to stdout, but a version
  # that does otherwise would silently write a prompt into the config. Check.
  case "$HASH" in
    \$2*) : ;;
    *) fail "caddy did not return a bcrypt hash. It returned: ${HASH:-<nothing>}" ;;
  esac
  # Single-quoted: systemd strips one layer of quotes and never expands inside
  # them, so the hash arrives intact whatever it contains.
  printf "MYANALYST_PASSWORD_HASH='%s'\n" "$HASH" > "$ETC_CADDY/env"
  chmod 600 "$ETC_CADDY/env"
  chown root:root "$ETC_CADDY/env" 2>/dev/null || true
  echo "    hash written to $ETC_CADDY/env"
fi

# A drop-in, not `systemctl edit --full`, which opens an editor and cannot run
# unattended. This is the same thing without the terminal.
mkdir -p "$UNIT_DIR/caddy.service.d"
cat > "$UNIT_DIR/caddy.service.d/myanalyst-env.conf" <<'UNIT'
[Service]
EnvironmentFile=/etc/caddy/env
UNIT
echo "    caddy reads $ETC_CADDY/env"

# Caddy substitutes {$VAR} when it adapts the config, and the hash reaches the
# service through the unit's EnvironmentFile - which a shell does not have. So
# validating without loading that file first makes the password look empty and
# reports the config invalid when it is not. Load it in a subshell, so the hash
# never leaks into the rest of this script's environment.
MYANALYST_PASSWORD_HASH="$(read_hash)" \
  caddy validate --config "$ETC_CADDY/Caddyfile" >/dev/null ||
  fail "the Caddyfile does not validate even with the hash substituted. The error above is the real one."
echo "    Caddyfile validates, with the password hash substituted"

$SYSTEMCTL daemon-reload
# A restart, not a reload: a reload re-reads the Caddyfile but not the unit's
# EnvironmentFile, so the password hash would never reach the process.
if ! $SYSTEMCTL restart caddy || { sleep 1; ! $SYSTEMCTL is-active --quiet caddy; }; then
  echo "!! caddy did not come back up. Here is why:" >&2
  journalctl -u caddy -n 30 --no-pager >&2 || true
  echo >&2
  echo "!! Putting the Caddyfile back so the other sites on this machine keep serving." >&2
  if [ -f "$BACKUP" ]; then
    cp "$BACKUP" "$ETC_CADDY/Caddyfile"
    python3 "$STRIPPER" "$ETC_CADDY/Caddyfile" >/dev/null || true
    rm -f "$UNIT_DIR/caddy.service.d/myanalyst-env.conf"
    $SYSTEMCTL daemon-reload
    $SYSTEMCTL restart caddy || true
    sleep 1
    if $SYSTEMCTL is-active --quiet caddy; then
      echo "!! Caddy is back on the previous config. myAnalyst is not configured; nothing else changed." >&2
    else
      echo "!! Caddy is still down on the previous config, so this is not myAnalyst's doing." >&2
    fi
  fi
  exit 1
fi
echo "    caddy restarted and running"

rm -f "$INCOMING"
echo "==> $SITE is configured. Now run ./deploy-app.sh on your own machine."
