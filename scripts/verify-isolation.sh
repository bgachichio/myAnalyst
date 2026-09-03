#!/usr/bin/env bash
# Prove, on the VM, that myAnalyst is isolated from everything else running.
# Read-only: it inspects and reports, it changes nothing. Run it after deploying
# and after any change to the unit.
set -uo pipefail

HOST="${MYANALYST_HOST:-pulse}"
fail=0
check() {  # check <description> <command>
  if ssh "$HOST" "$2" >/dev/null 2>&1; then
    printf '  PASS  %s\n' "$1"
  else
    printf '  FAIL  %s\n' "$1"; fail=1
  fi
}

echo "myAnalyst isolation check on $HOST"
echo
echo "Ports - the collector must listen on nothing"
if ssh "$HOST" "ss -tulpn 2>/dev/null | grep -i myanalyst" >/dev/null 2>&1; then
  echo "  FAIL  something called myanalyst is listening:"
  ssh "$HOST" "ss -tulpn | grep -i myanalyst"
  fail=1
else
  echo "  PASS  no listening socket"
fi

echo
echo "Filesystem - it owns four paths and writes to two"
check "runs through the release symlink" "test -L /opt/myanalyst/current"
check "store directory owned by the service user" "test \"\$(stat -c %U /var/lib/myanalyst)\" = myanalyst"
check "private output directory exists" "test -d /srv/myanalyst/private"
check "nothing written outside its own tree" \
  "! find / -xdev -newer /opt/myanalyst/current -user myanalyst -print -quit 2>/dev/null | grep -qv '^/\\(opt\\|var/lib\\|srv\\)/myanalyst'"

echo
echo "Sandbox - the unit really carries the restrictions"
for setting in "ProtectSystem=strict" "ProtectHome=yes" "PrivateTmp=yes" \
               "MemoryMax=268435456" "OOMScoreAdjust=800" "NoNewPrivileges=yes"; do
  check "$setting" "systemctl show myanalyst-collect.service -p ${setting%%=*} | grep -qi '${setting}'"
done

echo
echo "Neighbours - nothing of ours appears in theirs"
check "no Caddy site points at myanalyst" "! grep -rqi myanalyst /etc/caddy/ 2>/dev/null"
check "no PM2 process named myanalyst" "! (command -v pm2 >/dev/null && pm2 jlist 2>/dev/null | grep -qi myanalyst)"
check "no cron entry outside systemd" "! grep -rqi myanalyst /etc/cron.d/ /etc/crontab 2>/dev/null"

echo
echo "Footprint on a small box"
ssh "$HOST" "df -h / | tail -1; echo; du -sh /opt/myanalyst /var/lib/myanalyst /srv/myanalyst 2>/dev/null; echo; free -m | head -2"

echo
if [ "$fail" -eq 0 ]; then echo "ISOLATION OK"; else echo "ISOLATION FAILED - see the FAIL lines above"; fi
exit "$fail"
