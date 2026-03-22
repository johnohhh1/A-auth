"""Tests for the agent registry and token store."""

import time
import tempfile
import os
import pytest

# Point the DB at a temp file for tests
import aauth.db.registry as reg


@pytest.fixture(autouse=True)
def temp_db(tmp_path):
    """Redirect DB to a temp path for each test."""
    original = reg.DB_PATH
    reg.DB_PATH = tmp_path / "test_registry.db"
    reg.init_db()
    yield
    reg.DB_PATH = original


# ---- Agents ----

def test_register_and_get_agent():
    agent = reg.register_agent("bot-1", "Bot One", "test bot")
    assert agent.agent_id == "bot-1"
    assert agent.name == "Bot One"

    fetched = reg.get_agent("bot-1")
    assert fetched is not None
    assert fetched.agent_id == "bot-1"


def test_register_idempotent():
    reg.register_agent("bot-1", "Bot One", "first")
    reg.register_agent("bot-1", "Bot One Updated", "second")
    agent = reg.get_agent("bot-1")
    assert agent.name == "Bot One Updated"


def test_get_nonexistent_agent():
    assert reg.get_agent("ghost") is None


def test_list_agents():
    reg.register_agent("bot-1", "Bot One", "")
    reg.register_agent("bot-2", "Bot Two", "")
    agents = reg.list_agents()
    ids = [a.agent_id for a in agents]
    assert "bot-1" in ids
    assert "bot-2" in ids


def test_deregister_agent():
    reg.register_agent("bot-1", "Bot One", "")
    ok = reg.deregister_agent("bot-1")
    assert ok is True
    assert reg.get_agent("bot-1") is None


def test_deregister_nonexistent():
    ok = reg.deregister_agent("ghost")
    assert ok is False


def test_touch_agent():
    reg.register_agent("bot-1", "Bot One", "")
    before = reg.get_agent("bot-1").last_seen
    time.sleep(0.01)
    reg.touch_agent("bot-1")
    after = reg.get_agent("bot-1").last_seen
    assert after > before


# ---- Tokens ----

def test_mint_and_validate_one_shot():
    reg.register_agent("bot-1", "Bot One", "")
    tok = reg.mint_token("bot-1", "gmail", "read", "one_shot", 0)
    assert tok.token.startswith("aauth_")

    valid, reason = reg.validate_token(tok.token, "gmail", "read")
    assert valid is True
    assert reason == "ok"


def test_one_shot_consumed():
    reg.register_agent("bot-1", "Bot One", "")
    tok = reg.mint_token("bot-1", "gmail", "read", "one_shot", 0)
    reg.consume_token(tok.token)

    valid, reason = reg.validate_token(tok.token, "gmail", "read")
    assert valid is False
    assert "already used" in reason


def test_token_wrong_service():
    reg.register_agent("bot-1", "Bot One", "")
    tok = reg.mint_token("bot-1", "gmail", "read", "one_shot", 0)
    valid, reason = reg.validate_token(tok.token, "slack", "read")
    assert valid is False
    assert "gmail" in reason


def test_token_expired():
    reg.register_agent("bot-1", "Bot One", "")
    tok = reg.mint_token("bot-1", "gmail", "read", "time_window", 1)  # 1 second TTL
    time.sleep(1.1)
    valid, reason = reg.validate_token(tok.token, "gmail", "read")
    assert valid is False
    assert "expired" in reason


def test_token_not_expired():
    reg.register_agent("bot-1", "Bot One", "")
    tok = reg.mint_token("bot-1", "gmail", "read", "time_window", 300)  # 5 min
    valid, _ = reg.validate_token(tok.token, "gmail", "read")
    assert valid is True


def test_revoke_agent_tokens():
    reg.register_agent("bot-1", "Bot One", "")
    reg.mint_token("bot-1", "gmail", "read", "time_window", 300)
    reg.mint_token("bot-1", "gmail", "write", "time_window", 300)
    count = reg.revoke_agent_tokens("bot-1")
    assert count == 2
    assert reg.get_active_tokens("bot-1") == []


def test_get_active_tokens_excludes_expired():
    reg.register_agent("bot-1", "Bot One", "")
    reg.mint_token("bot-1", "gmail", "read", "time_window", 1)   # expires in 1s
    reg.mint_token("bot-1", "gmail", "write", "time_window", 300)  # active
    time.sleep(1.1)
    active = reg.get_active_tokens("bot-1")
    assert len(active) == 1
    assert active[0].action == "write"


def test_unknown_token():
    valid, reason = reg.validate_token("aauth_doesnotexist", "gmail", "read")
    assert valid is False
    assert "not found" in reason


# ---- Activity log ----

def test_log_and_get_activity():
    reg.register_agent("bot-1", "Bot One", "")
    reg.log_activity("bot-1", "gmail", "read", None, "approved")
    reg.log_activity("bot-1", "gmail", "send", None, "denied")

    events = reg.get_activity(agent_id="bot-1")
    assert len(events) == 2
    outcomes = {e["outcome"] for e in events}
    assert "approved" in outcomes
    assert "denied" in outcomes


def test_activity_limit():
    reg.register_agent("bot-1", "Bot One", "")
    for i in range(10):
        reg.log_activity("bot-1", "gmail", "read", None, "approved")
    events = reg.get_activity(agent_id="bot-1", limit=3)
    assert len(events) == 3
