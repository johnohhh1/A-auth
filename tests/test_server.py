"""Integration tests for the A-Auth HTTP daemon."""

import concurrent.futures
import json
import threading
import time
import urllib.request
import urllib.error
from unittest.mock import patch
import pytest

import aauth.db.registry as reg
from aauth.daemon.server import AAuthHandler, DEFAULT_PORT
from http.server import ThreadingHTTPServer


TEST_PORT = 17437  # offset to avoid conflicts


@pytest.fixture(scope="module", autouse=True)
def temp_db(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("db")
    original = reg.DB_PATH
    reg.DB_PATH = tmp / "test.db"
    reg.init_db()
    yield
    reg.DB_PATH = original


@pytest.fixture(scope="module")
def server():
    """Start a threaded test HTTP server on TEST_PORT for the module."""
    reg.init_db()
    httpd = ThreadingHTTPServer(("127.0.0.1", TEST_PORT), AAuthHandler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    time.sleep(0.1)  # let it bind
    yield f"http://127.0.0.1:{TEST_PORT}"
    httpd.shutdown()


def post(base, path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        base + path, data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def get(base, path):
    req = urllib.request.Request(base + path)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_health(server):
    status, data = get(server, "/health")
    assert status == 200
    assert data["status"] == "ok"


def test_register_agent(server):
    status, data = post(server, "/agents/register", {
        "agent_id": "test-bot",
        "name": "Test Bot",
        "description": "Integration test agent",
    })
    assert status == 201
    assert data["agent_id"] == "test-bot"


def test_register_missing_fields(server):
    status, data = post(server, "/agents/register", {"agent_id": ""})
    assert status == 400
    assert "error" in data


def test_list_agents(server):
    post(server, "/agents/register", {
        "agent_id": "list-bot", "name": "List Bot", "description": ""
    })
    status, data = get(server, "/agents")
    assert status == 200
    ids = [a["agent_id"] for a in data["agents"]]
    assert "list-bot" in ids


def test_request_unregistered_agent(server):
    status, data = post(server, "/request", {
        "agent_id": "ghost-bot",
        "service": "gmail",
        "action": "read",
        "scope": "one_shot",
        "ttl_seconds": 0,
    })
    assert status == 403
    assert "not registered" in data["error"]


def test_validate_invalid_token(server):
    status, data = post(server, "/validate", {
        "token": "aauth_fake",
        "service": "gmail",
        "action": "read",
    })
    assert status == 403
    assert data["valid"] is False


def test_validate_missing_fields(server):
    status, data = post(server, "/validate", {"token": "aauth_x"})
    assert status == 400


def test_consume(server):
    # Mint a token directly via DB, then consume via API
    post(server, "/agents/register", {
        "agent_id": "consume-bot", "name": "Consume Bot", "description": ""
    })
    tok = reg.mint_token("consume-bot", "gmail", "read", "one_shot", 0)

    status, data = post(server, "/consume", {"token": tok.token})
    assert status == 200
    assert data["consumed"] is True

    valid, reason = reg.validate_token(tok.token, "gmail", "read")
    assert valid is False


def test_revoke(server):
    post(server, "/agents/register", {
        "agent_id": "revoke-bot", "name": "Revoke Bot", "description": ""
    })
    reg.mint_token("revoke-bot", "gmail", "read", "time_window", 300)
    reg.mint_token("revoke-bot", "gmail", "write", "time_window", 300)

    status, data = post(server, "/agents/revoke-bot/revoke", {})
    assert status == 200
    assert data["revoked_tokens"] == 2


def test_deregister(server):
    post(server, "/agents/register", {
        "agent_id": "dereg-bot", "name": "Dereg Bot", "description": ""
    })
    status, data = post(server, "/agents/dereg-bot/deregister", {})
    assert status == 200
    assert data["deregistered"] is True

    status2, data2 = post(server, "/agents/ghost-bot/deregister", {})
    assert status2 == 404


def test_activity_log(server):
    post(server, "/agents/register", {
        "agent_id": "activity-bot", "name": "Activity Bot", "description": ""
    })
    reg.log_activity("activity-bot", "gmail", "read", None, "approved")

    status, data = get(server, "/activity?agent_id=activity-bot&limit=5")
    assert status == 200
    assert len(data["activity"]) >= 1


def test_agent_tokens(server):
    post(server, "/agents/register", {
        "agent_id": "token-bot", "name": "Token Bot", "description": ""
    })
    reg.mint_token("token-bot", "gmail", "read", "time_window", 300)

    status, data = get(server, "/agents/token-bot/tokens")
    assert status == 200
    assert len(data["tokens"]) == 1
    # Token should be partially redacted
    assert data["tokens"][0]["token"].endswith("...")


def test_404(server):
    status, data = get(server, "/nonexistent")
    assert status == 404


# ------------------------------------------------------------------ new tests


def test_malformed_json_body(server):
    """_read_body returns 400 on malformed JSON instead of silently passing {}."""
    raw = urllib.request.Request(
        server + "/agents/register",
        data=b"not valid json {{{",
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(raw, timeout=5) as r:
            status, data = r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        status, data = e.code, json.loads(e.read())
    assert status == 400
    assert "invalid JSON body" in data.get("error", "")


def test_validate_expired_token(server):
    """validate_token returns False and reason='token expired' for an expired token."""
    post(server, "/agents/register", {
        "agent_id": "expire-bot", "name": "Expire Bot", "description": ""
    })
    tok = reg.mint_token("expire-bot", "gmail", "read", "time_window", 1)
    time.sleep(1.1)  # let the 1-second TTL expire

    status, data = post(server, "/validate", {
        "token": tok.token,
        "service": "gmail",
        "action": "read",
    })
    assert status == 403
    assert data["valid"] is False
    assert "expired" in data.get("reason", "")


def test_concurrent_requests_all_succeed(server):
    """Multiple concurrent /request calls all get tokens when approval is mocked."""
    post(server, "/agents/register", {
        "agent_id": "concurrent-bot", "name": "Concurrent Bot", "description": ""
    })

    def make_request(_):
        return post(server, "/request", {
            "agent_id": "concurrent-bot",
            "service": "gmail",
            "action": "read",
            "scope": "one_shot",
            "ttl_seconds": 0,
        })

    with patch("aauth.daemon.server.prompt_approval", return_value=(True, None)):
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            results = list(executor.map(make_request, range(3)))

    for status, data in results:
        assert status == 200, f"Expected 200, got {status}: {data}"
        assert "token" in data


def test_approval_timeout_returns_denied(server):
    """When _timed_input returns None (timeout), the /request returns 403 denied."""
    post(server, "/agents/register", {
        "agent_id": "timeout-bot", "name": "Timeout Bot", "description": ""
    })

    with patch("aauth.daemon.server.prompt_approval", return_value=(False, None)):
        status, data = post(server, "/request", {
            "agent_id": "timeout-bot",
            "service": "gmail",
            "action": "read",
            "scope": "one_shot",
            "ttl_seconds": 0,
        })

    assert status == 403
    assert "denied" in data.get("error", "")
