# A-Auth

**Zero-trust approval for AI agents. Your phone is the vault.**

Every time an AI agent needs to access GitHub, Gmail, Stripe, or any service, it
asks A-Auth for permission. Your **phone buzzes**. You review the request, confirm
with your fingerprint, and approve or deny. The agent gets a short-lived token — or
gets blocked. Your actual credentials never touch the agent.

```
Agent             A-Auth Daemon           Your Phone
  |                    |                      |
  |-- POST /request -->|                      |
  |                    |-- push notification ->|
  |                    |                      | (biometric gate)
  |                    |<-- approve/deny ------|
  |<-- token ----------|                      |
  |                    |                      |
  | (uses token, not your password)
```

The approval callback travels directly over **Tailscale** — your private mesh.
Expo's push service carries only the notification. No cloud middleman touches
the auth decision.

> **v0.1 scope:** A-Auth is currently the *approval control plane* — it mints
> short-lived tokens that prove a human approved a request. The *credential proxy
> data plane* (where the daemon actually holds your OAuth tokens and proxies API
> calls) is the next chapter. See [TODOS.md](TODOS.md).

## Install

```bash
pip install aauth
```

Requires Python 3.11+. No external dependencies.

## Quickstart

**1. Install the phone app**

Download A-Auth from the [releases page](https://github.com/johnohhh1/A-auth/releases)
and install it on your Android phone.

**2. Start the daemon** (leave this running):

```bash
aauth daemon
```

**3. Pair your phone**

Open A-Auth on your phone → tap "Pair with your computer" → enter your Tailscale IP
(run `tailscale ip -4` on your computer to find it).

**4. Register your agent:**

```bash
aauth register my-agent "My AI Assistant"
```

**5. Use the SDK in your agent:**

```python
from aauth import AAuth

aa = AAuth(agent_id="my-agent")

# One-shot: approve this specific request
token = aa.request("gmail", "read")
# → your phone buzzes
# → you confirm with fingerprint
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

**6. Validate the token in your service integration:**

```python
# Your service layer validates before using any credential
import urllib.request, json

def is_approved(token: str, service: str, action: str) -> bool:
    req = urllib.request.Request(
        "http://localhost:7437/validate",
        data=json.dumps({"token": token, "service": service, "action": action}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read()).get("valid", False)
```

## TTY fallback

No phone? A-Auth falls back to a terminal prompt automatically:

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

A-Auth is a local HTTP daemon (port 7437) backed by SQLite. Agents talk to it over
localhost. No cloud, no external service — everything runs on your machine.
The phone connects to the daemon directly over Tailscale.

Token types:
- **one_shot** — single use, expires after first validation
- **time_window** — valid for N minutes (default 15)
- **task** — valid until explicitly revoked (max 4 hours)

## Using A-Auth from any LLM agent

See [AAUTH_SKILL.md](AAUTH_SKILL.md) for the full HTTP API reference. Any LLM can
use A-Auth by making simple HTTP calls — no SDK required.

## License

MIT
