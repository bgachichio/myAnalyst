#!/usr/bin/env bash
# Ship the collector to the VM. Build here, never there: 1 GB of RAM will OOM.
# Atomic: a new release directory, a symlink swap, a health check, and a
# rollback on any failure. Nothing is overwritten in place.
set -euo pipefail

HOST="${MYANALYST_HOST:-pulse}"

# Debian and its derivatives ship python3, not python, and mark the system
# environment externally managed (PEP 668). Prefer the project virtualenv, fall
# back to python3, and say so plainly rather than dying on "command not found".
if [ -x .venv/bin/python ]; then
  PYTHON=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON="python3"
else
  echo "!! no python3 on PATH. Install it, or create the venv: python3 -m venv .venv" >&2
  exit 1
fi

if ! "$PYTHON" -c "import pytest, build" 2>/dev/null; then
  cat >&2 <<'MISSING'
!! pytest and build are not available to this interpreter.

   On Debian, Zorin and friends the system Python is externally managed, so
   install into the project virtualenv instead of system-wide:

     python3 -m venv .venv
     .venv/bin/pip install -e ".[dev]" build

MISSING
  exit 1
fi
APP_DIR="/opt/myanalyst"
RELEASE="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"

echo "==> Verifying locally before anything leaves this machine"
"$PYTHON" -m pytest -q
npm test

echo "==> Building the wheel here"
rm -rf dist/*.whl
"$PYTHON" -m build --wheel
WHEEL="$(ls -1t dist/*.whl | head -1)"
WHEEL_NAME="$(basename "$WHEEL")"

# Rehearse the VM's install, here, before anything ships. Three deploys in a row
# failed on things this catches in eight seconds: a wheel filename pip refuses,
# a dependency that will not resolve, an entry point that does not exist.
echo "==> Rehearsing the remote install locally"
REHEARSAL="$(mktemp -d)"
trap 'rm -rf "$REHEARSAL"' EXIT
python3 -m venv "$REHEARSAL/venv"
"$REHEARSAL/venv/bin/pip" install --quiet --upgrade pip
"$REHEARSAL/venv/bin/pip" install --quiet --only-binary :all: "$WHEEL"
"$REHEARSAL/venv/bin/myanalyst-collect" --help >/dev/null
"$REHEARSAL/venv/bin/myanalyst-collect" --db "$REHEARSAL/store" --health >/dev/null 2>&1 && {
  echo "!! health passed on an empty store; the check is not checking" >&2; exit 1; }
echo "    install, entry point and health check all behave"

echo "==> Shipping release $RELEASE"
# Everything under $APP_DIR belongs to the service user, and this script runs as
# the login user. So the login user only ever writes to /tmp; sudo installs into
# place with the right ownership, and the venv is built as the service user.
scp -q "$WHEEL" "$HOST:/tmp/$WHEEL_NAME"
scp -q deploy/myanalyst-collect.service deploy/myanalyst-collect.timer "$HOST:/tmp/"

ssh "$HOST" bash -euo pipefail <<REMOTE
  sudo install -d -o myanalyst -g myanalyst -m 755 "$APP_DIR/releases/$RELEASE"
  # Keep the wheel's own filename: pip parses name, version and tags out of it
  # and refuses anything else.
  sudo install -o myanalyst -g myanalyst -m 644 \
    "/tmp/$WHEEL_NAME" "$APP_DIR/releases/$RELEASE/$WHEEL_NAME"
  rm -f "/tmp/$WHEEL_NAME"

  cd "$APP_DIR/releases/$RELEASE"
  sudo -u myanalyst python3 -m venv .venv
  sudo -u myanalyst .venv/bin/pip install --quiet --upgrade pip
  # Wheels only. A source build on this box is what the ban on building here means.
  sudo -u myanalyst .venv/bin/pip install --quiet --only-binary :all: "./$WHEEL_NAME"

  sudo install -m 644 /tmp/myanalyst-collect.service /etc/systemd/system/
  sudo install -m 644 /tmp/myanalyst-collect.timer   /etc/systemd/system/
  rm -f /tmp/myanalyst-collect.service /tmp/myanalyst-collect.timer
  sudo systemctl daemon-reload

  # Atomic: build the new link beside the old one, then rename over it.
  sudo -u myanalyst ln -sfn "$APP_DIR/releases/$RELEASE" "$APP_DIR/current.new"
  sudo -u myanalyst mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
  sudo systemctl enable --now myanalyst-collect.timer
REMOTE

# Verification separates two questions that are not the same question.
#
# Does the install work? If not, roll back: the code is wrong.
# Is there fresh data? On a first deploy there is none, by definition, and a
# scrape that fails because the NSE page changed is not a reason to revert
# working code. So the collection runs, and its outcome is reported, but only
# a broken install triggers a rollback.

echo "==> Verifying the install"
if ! ssh "$HOST" "sudo -u myanalyst $APP_DIR/current/.venv/bin/myanalyst-collect --help >/dev/null"; then
  echo "!! the entry point does not run, rolling back"
  ./rollback.sh
  exit 1
fi
echo "    entry point runs"

echo "==> First collection"
if ssh "$HOST" "sudo -u myanalyst $APP_DIR/current/.venv/bin/myanalyst-collect \
     --db /var/lib/myanalyst/store --out /srv/myanalyst/private"; then
  echo "    collected"
else
  echo "!! the collection did not succeed. The install is sound and stays deployed;"
  echo "   this is a source or a parsing problem. Read the output above, and:"
  echo "     ssh $HOST 'sudo journalctl -u myanalyst-collect -n 50 --no-pager'"
fi

echo "==> Health"
ssh "$HOST" "sudo -u myanalyst $APP_DIR/current/.venv/bin/myanalyst-collect \
  --health --db /var/lib/myanalyst/store" || true

# Keep current + one predecessor. Each release carries its own venv.
ssh "$HOST" "sudo sh -c 'ls -1dt $APP_DIR/releases/* | tail -n +3 | xargs -r rm -rf'"
echo "==> Deployed $RELEASE"
