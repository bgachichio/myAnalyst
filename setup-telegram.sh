#!/usr/bin/env bash
# One-time: put the Telegram alert credentials on the VM and fire a test alert.
# The token is typed on the VM. It never passes through this machine.
set -euo pipefail
HOST="${MYANALYST_HOST:-pulse}"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true 2>/dev/null ||
  { echo "!! cannot ssh to '$HOST' without a prompt." >&2; exit 1; }
scp -q deploy/setup-telegram-remote.sh "$HOST:/tmp/"
ssh -t "$HOST" 'sudo bash /tmp/setup-telegram-remote.sh; rm -f /tmp/setup-telegram-remote.sh'
