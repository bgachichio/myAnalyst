#!/usr/bin/env bash
# Take myAnalyst back out of Caddy and get Caddy running again.
#
# Removes only what setup-remote.sh added: the appended site block and the
# systemd drop-in. Everything that was already there is restored from the
# backup taken before the block was appended.
set -euo pipefail

SITE="analyst.gachichio.org"
ETC_CADDY="${ETC_CADDY:-/etc/caddy}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
BACKUP="$ETC_CADDY/Caddyfile.pre-myanalyst"

if [ -f "$BACKUP" ]; then
  cp "$BACKUP" "$ETC_CADDY/Caddyfile"
  echo "    Caddyfile restored from $BACKUP"
else
  # No backup: strip the block by hand, from its header comment to the closing
  # brace at column one. Safe because the block is always appended last.
  python3 - "$ETC_CADDY/Caddyfile" "$SITE" <<'PY'
import re, sys
path, site = sys.argv[1], sys.argv[2]
text = open(path).read()
start = text.find(f"# myAnalyst — {site}")
if start == -1:
    start = text.find(f"{site} {{")
if start == -1:
    print("    no myAnalyst block found; nothing to strip")
    raise SystemExit(0)
rest = text[start:]
end = rest.find("\n}\n")
open(path, "w").write(text[:start] + (rest[end + 3:] if end != -1 else ""))
print("    myAnalyst block stripped from the Caddyfile")
PY
fi

rm -f "$UNIT_DIR/caddy.service.d/myanalyst-env.conf"
rmdir "$UNIT_DIR/caddy.service.d" 2>/dev/null || true
echo "    systemd drop-in removed"

$SYSTEMCTL daemon-reload
$SYSTEMCTL restart caddy
sleep 1
if $SYSTEMCTL is-active --quiet caddy; then
  echo "==> Caddy is running again. myAnalyst is not configured; everything else is as it was."
else
  echo "!! Caddy is still down. This is now unrelated to myAnalyst:" >&2
  journalctl -u caddy -n 40 --no-pager >&2 || true
  exit 1
fi
