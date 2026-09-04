#!/usr/bin/env bash
# Previous good release. One command, no rebuild, no thought required at 02:00.
set -euo pipefail
HOST="${MYANALYST_HOST:-pulse}"
APP_DIR="/opt/myanalyst"

ssh "$HOST" bash -euo pipefail <<'REMOTE'
  APP_DIR="/opt/myanalyst"
  current="$(readlink -f $APP_DIR/current || true)"
  previous="$(ls -1dt $APP_DIR/releases/* | grep -v "^$current$" | head -1 || true)"
  test -n "$previous" || { echo "no previous release to roll back to"; exit 1; }
  echo "rolling back to $previous"
  sudo -u myanalyst ln -sfn "$previous" $APP_DIR/current.new
  sudo -u myanalyst mv -Tf $APP_DIR/current.new $APP_DIR/current
  sudo systemctl restart myanalyst-collect.timer
REMOTE

ssh "$HOST" "sudo -u myanalyst /opt/myanalyst/current/.venv/bin/myanalyst-collect \
  --health --db /var/lib/myanalyst/store"
echo "==> Rolled back"
