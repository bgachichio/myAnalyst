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
if grep -q "$SITE" "$ETC_CADDY/Caddyfile"; then
  echo "    the site block is already in the Caddyfile, leaving it alone"
else
  cat "$INCOMING" >> "$ETC_CADDY/Caddyfile"
  echo "    site block appended to the Caddyfile"
fi

if [ -s "$ETC_CADDY/env" ] && grep -q '^MYANALYST_PASSWORD_HASH=\$2' "$ETC_CADDY/env"; then
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
  printf 'MYANALYST_PASSWORD_HASH=%s\n' "$HASH" > "$ETC_CADDY/env"
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

caddy validate --config "$ETC_CADDY/Caddyfile" >/dev/null || fail "the Caddyfile does not validate."
echo "    Caddyfile validates"

$SYSTEMCTL daemon-reload
# A restart, not a reload: a reload re-reads the Caddyfile but not the unit's
# EnvironmentFile, so the password hash would never reach the process.
$SYSTEMCTL restart caddy
sleep 1
$SYSTEMCTL is-active --quiet caddy || fail "caddy did not come back up. journalctl -u caddy -n 30"
echo "    caddy restarted and running"

rm -f "$INCOMING"
echo "==> $SITE is configured. Now run ./deploy-app.sh on your own machine."
