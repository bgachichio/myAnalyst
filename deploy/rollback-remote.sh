#!/usr/bin/env bash
# Take myAnalyst back out of Caddy and get Caddy running again.
#
# Restores the backup if there is one, then strips the myAnalyst block from the
# result either way. The backup can itself contain the block - it did, because
# it was first taken after the block had already been appended - so restoring
# alone is not enough and never was.
set -euo pipefail

ETC_CADDY="${ETC_CADDY:-/etc/caddy}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
STRIPPER="${STRIPPER:-/tmp/caddyfile-block.py}"
BACKUP="$ETC_CADDY/Caddyfile.pre-myanalyst"

if [ -f "$BACKUP" ]; then
  cp "$BACKUP" "$ETC_CADDY/Caddyfile"
  echo "    Caddyfile restored from $BACKUP"
fi

python3 "$STRIPPER" "$ETC_CADDY/Caddyfile"

# A backup that still carries the block is worse than no backup: it makes the
# rollback look like it worked. Clean it too, so the next one is trustworthy.
[ -f "$BACKUP" ] && python3 "$STRIPPER" "$BACKUP"

rm -f "$UNIT_DIR/caddy.service.d/myanalyst-env.conf"
rmdir "$UNIT_DIR/caddy.service.d" 2>/dev/null || true
echo "    systemd drop-in removed"

$SYSTEMCTL daemon-reload
$SYSTEMCTL restart caddy || true
sleep 1
if $SYSTEMCTL is-active --quiet caddy; then
  echo "==> Caddy is running again. myAnalyst is not configured; everything else is as it was."
else
  echo "!! Caddy is still down with myAnalyst fully removed, so the cause is elsewhere:" >&2
  journalctl -u caddy -n 30 --no-pager >&2 || true
  exit 1
fi
