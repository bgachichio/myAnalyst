#!/usr/bin/env bash
# Put the Telegram alert credentials on the VM. Runs as root, on the VM.
#
# The token is typed here and goes straight into the service user's env file.
# It never travels through a command line, a chat window or a shell history,
# and it is never echoed back.
set -euo pipefail

SECRETS_DIR="${SECRETS_DIR:-/home/myanalyst/secrets}"
ENV_FILE="$SECRETS_DIR/myanalyst.env"
OWNER="${OWNER:-myanalyst}"
COLLECT="${COLLECT:-/opt/myanalyst/current/.venv/bin/myanalyst-collect}"

fail() { echo "!! $*" >&2; exit 1; }

id -u "$OWNER" >/dev/null 2>&1 || fail "no '$OWNER' user. Run ./deploy.sh first."
install -d -o "$OWNER" -g "$OWNER" -m 700 "$SECRETS_DIR"

echo
echo "    Telegram bot token. Nothing echoes as you type."
IFS= read -rs TOKEN; echo
[ -n "$TOKEN" ] || fail "no token given."
case "$TOKEN" in
  [0-9]*:*) : ;;
  *) fail "that does not look like a bot token (digits, a colon, then the secret)." ;;
esac

# Ask Telegram which chats have written to this bot, so the id does not have to
# be hunted down by hand. The token goes to curl on stdin, never in argv where
# `ps` would show it.
echo "    Asking Telegram which chats have messaged this bot..."
UPDATES="$(printf 'url = "https://api.telegram.org/bot%s/getUpdates"\n' "$TOKEN" |
  curl -fsS --max-time 20 --config - || true)"

CHATS="$(printf '%s' "$UPDATES" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if not data.get("ok"):
    sys.exit(0)
seen = {}
for update in data.get("result", []):
    for key in ("message", "edited_message", "channel_post", "my_chat_member"):
        chat = (update.get(key) or {}).get("chat")
        if chat:
            name = chat.get("title") or " ".join(
                filter(None, [chat.get("first_name"), chat.get("last_name")])
            ) or chat.get("username") or chat.get("type", "chat")
            seen[str(chat["id"])] = name
for chat_id, name in seen.items():
    print(f"{chat_id}\t{name}")
' 2>/dev/null || true)"

if [ -n "$CHATS" ]; then
  echo "    Chats that have messaged this bot:"
  printf '%s\n' "$CHATS" | while IFS=$'\t' read -r cid name; do echo "      $cid  ($name)"; done
  DEFAULT="$(printf '%s' "$CHATS" | head -1 | cut -f1)"
  printf '    Chat id [%s]: ' "$DEFAULT"
  IFS= read -r CHAT || true; echo
  [ -n "$CHAT" ] || CHAT="$DEFAULT"
else
  echo "    Telegram returned no chats. Send the bot a message first, then re-run,"
  echo "    or type the chat id now if you already know it."
  printf '    Chat id: '
  IFS= read -r CHAT || true; echo
fi
[ -n "$CHAT" ] || fail "no chat id given."

# Keep whatever else is in the file; replace only the Telegram pair.
TMP="$(mktemp)"; chmod 600 "$TMP"
if [ -f "$ENV_FILE" ]; then grep -v '^TELEGRAM_' "$ENV_FILE" > "$TMP" || true; fi
grep -q '^MYANALYST_DB='     "$TMP" 2>/dev/null || echo 'MYANALYST_DB=/var/lib/myanalyst/store'   >> "$TMP"
grep -q '^MYANALYST_OUT='    "$TMP" 2>/dev/null || echo 'MYANALYST_OUT=/srv/myanalyst/private'    >> "$TMP"
grep -q '^MYANALYST_WINDOW_DAYS=' "$TMP" 2>/dev/null || echo 'MYANALYST_WINDOW_DAYS=400'          >> "$TMP"
printf 'TELEGRAM_BOT_TOKEN=%s\n' "$TOKEN" >> "$TMP"
printf 'TELEGRAM_CHAT_ID=%s\n'  "$CHAT"  >> "$TMP"
install -o "$OWNER" -g "$OWNER" -m 600 "$TMP" "$ENV_FILE"
rm -f "$TMP"
echo "    written to $ENV_FILE, mode 600, owned by $OWNER"

if [ ! -x "$COLLECT" ]; then
  echo "!! $COLLECT is not there, so the alert cannot be fired yet." >&2
  echo "   Run ./deploy.sh to put the collector on this machine, then re-run this." >&2
  exit 1
fi

echo "    Firing one alert on purpose. An alert nobody has seen arrive is not an alert."
sudo -u "$OWNER" bash -c '
  set -a
  while IFS= read -r line; do
    case "$line" in ""|\#*) continue ;; esac
    export "$line"
  done < "'"$ENV_FILE"'"
  set +a
  exec "'"$COLLECT"'" --test-alert'
