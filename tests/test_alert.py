"""Alerting must never take the run down with it, and must never log a token."""
from __future__ import annotations

import logging

import httpx
import pytest

from collector import alert


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)


def test_unconfigured_is_not_an_error(caplog):
    with caplog.at_level(logging.WARNING):
        assert alert.send("anything") is False
    assert "silent" in caplog.text
    assert not alert.configured()


def test_a_failed_delivery_never_raises(monkeypatch, caplog):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-token-value")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "123")

    def boom(*_a, **_k):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(httpx, "post", boom)
    with caplog.at_level(logging.ERROR):
        assert alert.send("collection failed") is False
    assert "test-token-value" not in caplog.text, "a token must never reach a log line"


def test_a_successful_delivery_reports_true(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "t")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "123")
    sent = {}

    class Ok:
        def raise_for_status(self): ...

    def capture(url, json, timeout):
        sent["url"] = url
        sent["json"] = json
        return Ok()

    monkeypatch.setattr(httpx, "post", capture)
    assert alert.send("hello") is True
    assert sent["json"]["chat_id"] == "123"
    assert sent["json"]["text"] == "hello"


def test_a_parse_failure_alerts_and_stores_nothing(monkeypatch, tmp_path):
    """The failure mode that matters: the page changed and nobody noticed."""
    import datetime as dt

    from collector import run as run_module
    from collector.nse import ParseFailed
    from collector.store import PriceStore

    monkeypatch.setattr(run_module, "fetch_latest", lambda *_a, **_k: (_ for _ in ()).throw(ParseFailed("layout changed")))
    fired: list[str] = []
    monkeypatch.setattr(run_module.alert, "send", lambda text: fired.append(text) or True)

    with PriceStore(tmp_path / "p.duckdb") as store:
        code = run_module.collect(store, dt.date(2026, 9, 3), window=400, out_dir=None)
        assert code == 3
        assert store.db.execute("SELECT count(*) FROM daily_prices").fetchone()[0] == 0

    assert fired and "layout" in fired[0]
