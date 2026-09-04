#!/usr/bin/env bash
# Previous good release. One command, no rebuild, no thought required at 02:00.
#
# "Good" means complete: a release whose virtualenv and entry point actually
# exist. A deploy that died half way leaves a directory behind, and rolling back
# onto one of those turns a bad deploy into a dead one.
set -euo pipefail
HOST="${MYANALYST_HOST:-pulse}"

ssh "$HOST" bash -euo pipefail <<'REMOTE'
  APP_DIR="/opt/myanalyst"
  BIN=".venv/bin/myanalyst-collect"
  current="$(readlink -f $APP_DIR/current 2>/dev/null || true)"

  previous=""
  for candidate in $(ls -1dt $APP_DIR/releases/* 2>/dev/null); do
    [ "$candidate" = "$current" ] && continue
    [ -x "$candidate/$BIN" ] || { echo "skipping incomplete release $candidate"; continue; }
    previous="$candidate"
    break
  done

  if [ -z "$previous" ]; then
    echo "no complete previous release to roll back to." >&2
    echo "the current release stays in place; deploy a known-good build instead." >&2
    exit 1
  fi

  echo "rolling back to $previous"
  sudo -u myanalyst ln -sfn "$previous" $APP_DIR/current.new
  sudo -u myanalyst mv -Tf $APP_DIR/current.new $APP_DIR/current
  sudo systemctl restart myanalyst-collect.timer
  sudo -u myanalyst "$previous/$BIN" --help >/dev/null
  echo "entry point runs"
REMOTE

echo "==> Rolled back"
