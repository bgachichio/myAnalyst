#!/usr/bin/env bash
# One-time: configure analyst.gachichio.org on the VM. Safe to re-run.
set -euo pipefail

HOST="${MYANALYST_HOST:-pulse}"

ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true 2>/dev/null ||
  { echo "!! cannot ssh to '$HOST' without a prompt. Check ~/.ssh/config and your agent." >&2; exit 1; }

echo "==> Configuring the site on $HOST"
scp -q deploy/Caddyfile.analyst deploy/setup-remote.sh deploy/caddyfile-block.py "$HOST:/tmp/"

# -t so the password prompt has a real terminal. The script is a file on the VM
# rather than a heredoc on stdin, because -t and a heredoc fight over stdin and
# the prompt never appears.
ssh -t "$HOST" 'sudo bash /tmp/setup-remote.sh; rm -f /tmp/setup-remote.sh'
