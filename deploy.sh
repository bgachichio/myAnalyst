#!/usr/bin/env bash
# Ship the collector to the VM. Build here, never there: 1 GB of RAM will OOM.
# Atomic: a new release directory, a symlink swap, a health check, and a
# rollback on any failure. Nothing is overwritten in place.
set -euo pipefail

HOST="${MYANALYST_HOST:-pulse}"
APP_DIR="/opt/myanalyst"
RELEASE="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"

echo "==> Verifying locally before anything leaves this machine"
python -m pytest -q
npm test

echo "==> Building the wheel here"
rm -rf dist/*.whl
python -m build --wheel

echo "==> Shipping release $RELEASE"
ssh "$HOST" "mkdir -p $APP_DIR/releases/$RELEASE"
scp dist/*.whl "$HOST:$APP_DIR/releases/$RELEASE/"
scp deploy/myanalyst-collect.service deploy/myanalyst-collect.timer "$HOST:/tmp/"

ssh "$HOST" bash -euo pipefail <<REMOTE
  cd $APP_DIR/releases/$RELEASE
  python3 -m venv .venv
  # Wheels only. A source build on this box is what the ban on building here means.
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet --only-binary :all: ./*.whl

  sudo install -m 644 /tmp/myanalyst-collect.service /etc/systemd/system/
  sudo install -m 644 /tmp/myanalyst-collect.timer   /etc/systemd/system/
  sudo systemctl daemon-reload

  ln -sfn $APP_DIR/releases/$RELEASE $APP_DIR/current.new
  mv -Tf $APP_DIR/current.new $APP_DIR/current
  sudo systemctl enable --now myanalyst-collect.timer
REMOTE

echo "==> Verifying"
if ! ssh "$HOST" "$APP_DIR/current/.venv/bin/myanalyst-collect --health --db /var/lib/myanalyst/prices.duckdb"; then
  echo "!! health check failed, rolling back"
  ./rollback.sh
  exit 1
fi

# Keep current + one predecessor. Each release carries its own venv.
ssh "$HOST" "ls -1dt $APP_DIR/releases/* | tail -n +3 | xargs -r rm -rf"
echo "==> Deployed $RELEASE"
