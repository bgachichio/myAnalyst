#!/usr/bin/env bash
# Emergency: take myAnalyst out of Caddy and get the other sites back up.
set -euo pipefail
HOST="${MYANALYST_HOST:-pulse}"
echo "==> Removing myAnalyst from Caddy on $HOST"
scp -q deploy/rollback-remote.sh "$HOST:/tmp/"
ssh "$HOST" 'sudo bash /tmp/rollback-remote.sh; rm -f /tmp/rollback-remote.sh'
