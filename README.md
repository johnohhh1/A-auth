# A-Auth

**Zero-trust credential proxy for AI agents. Your phone is the vault — agents never see your keys.**

Every time an AI agent needs to access Gmail, Slack, or any service, it asks A-Auth for permission. You get a notification on your terminal (and desktop). You approve or deny. The agent gets a short-lived token. Your actual credentials never touch the agent.

```
Agent          A-Auth Daemon       You
  |                  |               |
  |-- POST /request ->|               |
  |                  |-- "allow?" -->|
  |                  |<-- "yes" -----|
  |<-- token --------|               |
  |                  |               |
  | (uses token, not your password)  |
```

## Install

```bash
pip install aauth
```

Requires Python 3.11+. No external dependencies.

## Quickstart

**1. Start the daemon** (leave this running in a terminal):

```bash
aauth daemon
```

**2. Register your agent:**

```bash
aauth register my-agent "My AI Assistant"
```

**3. Use the SDK in your agent:**

```python
from aauth import AAuth

aa = AAuth(agent_id="my-agent")

# One-shot: approve this specific request
token = aa.request("gmail", "read")
# → your terminal shows an approval prompt
# → you type 'y'
# → token returned, valid for one use

# Time-windowed: approve for 15 minutes
with aa.window("gmail", "read", ttl_minutes=15) as session:
    token = session.token
    # use token for up to 15 minutes without re-approving

# Task-scoped: approve until the task completes
with aa.task("daily-digest") as task:
    gmail_token = task.request("gmail", "read")
    sheets_token = task.request("sheets", "write")
    # ... do work ...
# tokens revoked automatically on exit
```

**4. Pass the token to your service (not your password):**

```python
# Your service integration validates the token before using credentials
import requests
resp = requests.get(
    "https://your-service-bridge.com/gmail/messages",
    headers={"X-AAuth-Token": token}
)
```

## Approval prompt

When an agent requests access, you see:

```
============================================================
  A-Auth Approval Request
============================================================
  Agent:   My AI Assistant (my-agent)
  Service: gmail
  Action:  read
  Scope:   one-shot (single use)
============================================================
  [y] Approve  [n] Deny  [1] One-shot  [15] 15-min  [60] 60-min
  Timeout: 60s
  >
```

Type `y` to approve, `n` to deny, or a number of minutes to override the scope.

## CLI reference

```bash
aauth daemon              # Start the daemon
aauth status              # Check if daemon is running
aauth register <id> <name> [description]
aauth deregister <id>
aauth list                # List registered agents
aauth request <agent> <service> <action>  # Manual request (for testing)
aauth revoke <agent>      # Revoke all tokens for an agent
aauth tokens <agent>      # List active tokens
aauth activity [--agent-id <id>] [--limit N]
aauth validate <token> <service> <action>
```

## How it works

A-Auth is a local HTTP daemon (port 7437) backed by SQLite. Agents talk to it over localhost. No cloud, no external service — everything runs on your machine.

Token types:
- **one_shot** — single use, expires after first validation
- **time_window** — valid for N minutes (default 15)
- **task** — valid until explicitly revoked (max 4 hours)

## Using A-Auth from any LLM agent

See [AAUTH_SKILL.md](AAUTH_SKILL.md) for the full HTTP API reference. Any LLM can use A-Auth by making simple HTTP calls — no SDK required.

## License

MIT
