#!/usr/bin/env bash
# Ship the PWA to the VM, same origin as its data. Build here, never there.
set -euo pipefail

HOST="${MYANALYST_HOST:-pulse}"
APP_DIR="/srv/myanalyst/app"
SITE="analyst.gachichio.org"

# Preflight. Everything here is read-only and takes two seconds, and it runs
# before the build rather than after the swap: the failure this prevents is a
# deploy that succeeds, fails its own verification for an unrelated reason, and
# tells you to roll back a release that was fine.
echo "==> Preflight"

# The password is needed only so the deploy can prove the site answers. Ask for
# it here rather than making it a step of its own: setting it beforehand meant
# two lines, and two lines pasted together let `read` swallow an empty one and
# hand the deploy a blank password.
if [ -z "${MYANALYST_PASSWORD:-}" ]; then
  if [ -t 0 ]; then
    for attempt in 1 2 3; do
      printf 'Site password for %s (nothing echoes): ' "$SITE" >&2
      IFS= read -rs MYANALYST_PASSWORD < /dev/tty || true
      printf '\n' >&2
      [ -n "$MYANALYST_PASSWORD" ] && break
      echo "   empty; try again ($attempt of 3)" >&2
    done
    [ -n "$MYANALYST_PASSWORD" ] || { echo "!! no password given." >&2; exit 1; }
  else
    echo "!! MYANALYST_PASSWORD is not set and there is no terminal to ask on." >&2
    echo "   Export it before running this non-interactively." >&2
    exit 1
  fi
fi

ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true 2>/dev/null || {
  echo "!! cannot ssh to '$HOST' without a prompt. Check ~/.ssh/config and your agent." >&2
  exit 1
}

# The one-time setup in DEPLOY.md §6 appends the site to the Caddyfile. Without
# it the deploy works, Caddy serves something else on that name, and the
# verification failure points at the app instead of at the missing block.
ssh "$HOST" "sudo grep -q '$SITE' /etc/caddy/Caddyfile" 2>/dev/null || {
  echo "!! $SITE is not in /etc/caddy/Caddyfile on $HOST." >&2
  echo "   Run the one-time block in DEPLOY.md §6 first: the site, the password hash, the app directory." >&2
  exit 1
}
echo "    password set, $HOST reachable, $SITE configured"

echo "==> Building and checking the app here"
npm ci --silent
npm test
npm run build

# The unit tests prove the arithmetic. This drives the built app in a real
# browser and pushes a real PDF through the reader, because a build that
# compiles and does not work is the failure this catches.
node scripts/browser-check.mjs

test -f dist/index.html || { echo "!! no dist/index.html; the build produced nothing" >&2; exit 1; }
echo "    $(find dist -type f | wc -l) files, $(du -sh dist | cut -f1)"

echo "==> Shipping to $HOST:$APP_DIR"
tar -czf /tmp/myanalyst-app.tgz -C dist .
scp -q /tmp/myanalyst-app.tgz "$HOST:/tmp/"
rm -f /tmp/myanalyst-app.tgz

ssh "$HOST" bash -euo pipefail <<'REMOTE'
  APP_DIR="/srv/myanalyst/app"
  STAGE="$(mktemp -d)"
  tar -xzf /tmp/myanalyst-app.tgz -C "$STAGE"
  rm -f /tmp/myanalyst-app.tgz

  # Swap the whole directory at once. A half-copied app is a broken app.
  sudo install -d -o myanalyst -g myanalyst -m 755 "$APP_DIR.new"
  sudo cp -r "$STAGE/." "$APP_DIR.new/"
  sudo chown -R myanalyst:myanalyst "$APP_DIR.new"
  sudo rm -rf "$APP_DIR.old"
  [ -d "$APP_DIR" ] && sudo mv "$APP_DIR" "$APP_DIR.old"
  sudo mv "$APP_DIR.new" "$APP_DIR"
  rm -rf "$STAGE"

  sudo caddy validate --config /etc/caddy/Caddyfile >/dev/null
  sudo systemctl reload caddy
REMOTE

echo "==> Verifying"
# The password goes in on stdin, never in argv. curl does blank out a -u value
# in its own argv once it has parsed it - measured, not assumed - so the `ps`
# window is brief rather than open. What the blanking cannot reach is
# everything upstream of exec: the shell expands the variable into the command
# line first, so it lands in a `set -x` trace, in shell history when this is
# run by hand, and in any CI log that echoes commands. --config - keeps it out
# of all of those, and out of the secret scanner's pattern.
code="$(printf 'user = "brian:%s"\n' "$MYANALYST_PASSWORD" |
  curl -fsS --config - -o /dev/null -w '%{http_code}' \
    "https://$SITE/" || true)"
echo "    https://$SITE/ -> $code"
test "$code" = "200" || {
  echo "!! not serving (HTTP $code)." >&2
  case "$code" in
    401) echo "   401 means Caddy answered and rejected the password: the app shipped, the credential is wrong." >&2 ;;
    000) echo "   000 means nothing answered: check DNS, the firewall, and that Caddy is running." >&2 ;;
  esac
  # Only offer the rollback that exists. On a first deploy there is no previous
  # release, and a command that would delete the app and move nothing back is a
  # worse outcome than the failure it is meant to undo.
  if ssh "$HOST" "[ -d '$APP_DIR.old' ]" 2>/dev/null; then
    echo "   Roll back: ssh $HOST \"sudo rm -rf $APP_DIR && sudo mv $APP_DIR.old $APP_DIR && sudo systemctl reload caddy\"" >&2
  else
    echo "   No previous release to roll back to; this is the first deploy of the app." >&2
  fi
  exit 1
}
echo "==> Deployed"
