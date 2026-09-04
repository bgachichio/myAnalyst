#!/usr/bin/env bash
# Ship the PWA to the VM, same origin as its data. Build here, never there.
set -euo pipefail

HOST="${MYANALYST_HOST:-pulse}"
APP_DIR="/srv/myanalyst/app"

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
code="$(curl -fsS -o /dev/null -w '%{http_code}' -u "brian:${MYANALYST_PASSWORD:-}" \
  https://analyst.gachichio.org/ || true)"
echo "    https://analyst.gachichio.org/ -> $code"
test "$code" = "200" || {
  echo "!! not serving. Roll back with: ssh $HOST 'sudo rm -rf $APP_DIR && sudo mv $APP_DIR.old $APP_DIR && sudo systemctl reload caddy'"
  exit 1
}
echo "==> Deployed"
