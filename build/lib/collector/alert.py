"""Telegram alerting. Alerts only, never a control plane (building §2.5).

A silent failure is the worst outcome here: the store simply stops advancing and
the app keeps showing a stale price that looks fine. So a failed run has to reach
Brian's phone, and the channel has to be proved by firing it once on purpose,
which `--test-alert` exists for.

The token lives in ~/secrets/myanalyst.env on the VM, mode 600, never in this
repository and never in a log line.
"""
from __future__ import annotations

import logging
import os

import httpx

log = logging.getLogger("collector.alert")

API = "https://api.telegram.org/bot{token}/sendMessage"
TIMEOUT = 15.0


def configured() -> bool:
    return bool(os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID"))


def send(text: str) -> bool:
    """Best effort. An alert that fails must never take the run down with it."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if not (token and chat):
        log.warning("no alert channel configured; failure will be silent")
        return False
    try:
        r = httpx.post(
            API.format(token=token),
            json={"chat_id": chat, "text": text, "disable_web_page_preview": True},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return True
    except Exception as exc:
        # Never log the token, and never re-raise: the collection outcome stands.
        log.error("alert delivery failed: %s", type(exc).__name__)
        return False
