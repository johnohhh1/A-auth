# TODOS

## What's shipped (v0.1 — approval control plane)
- Daemon: ThreadingHTTPServer, token lifecycle, SQLite registry, activity log
- SDK: zero-dependency Python client, PermissionChain context manager
- CLI: daemon, register, revoke, status, activity
- Mobile app: push notifications, biometric gate, Tailscale pairing, approval screen
- CI + release workflow (PyPI trusted publishing ready, needs manual trigger)

---

## P1 — Credential proxy (data plane) — the product gap

Right now A-Auth mints *approval tokens* — proof that a human approved a request.
The daemon doesn't hold real credentials and doesn't proxy API calls.
The agent still needs to know the actual OAuth token / API key to use it.

**What needs to be built:**
- `aauth/vault/` — encrypted credential store on the daemon
- Per-service adapters (Gmail, GitHub, Stripe, etc.)
- Proxy endpoint: agent presents A-Auth token → daemon makes the downstream
  API call → returns result → agent never sees the raw credential

This is what makes "your phone is the vault" true at the data layer, not just
the approval layer. Until this ships, A-Auth is the control plane only.

**Also:** SQLCipher for the registry once it holds real secrets (currently plain sqlite3,
fine for tokens, not fine for OAuth keys).

---

## P2 — Next sprint (post app + PyPI)

## SDK / CLI

### Extract shared HTTP helper before MCP server (Sprint 2)

**What:** Extract `_post()` from `sdk/client.py` and `cli/__main__.py` into `aauth/http_util.py`.

**Why:** Both files already share ~80% of the same HTTP helper. The MCP server (Sprint 2) will need a third copy — extract before it arrives.

**Context:** `sdk/client.py._post()` raises `AAuthError` on HTTP errors; `cli/__main__.py._post()` calls `sys.exit(1)`. A shared `raw_post()` can return `(status, data)` and let each caller handle errors in its own idiom. Start by reading both `_post` implementations — they differ only in the error branch.

**Effort:** S
**Priority:** P2
**Depends on:** Sprint 2 MCP server work

---

## Daemon / Notify

### Windows support for `_timed_input`

**What:** Replace or supplement `select.select([sys.stdin], ...)` with a Windows-compatible stdin timeout.

**Why:** `select.select` on file descriptors is Unix-only. A-Auth currently requires Linux (`notify-send`) so this isn't blocking, but a future Windows port of the notify layer would hit this constraint immediately.

**Context:** `aauth/daemon/notify.py:_timed_input()` uses `select.select([sys.stdin], [], [], timeout)`. On Windows, use `msvcrt.kbhit()` polling or a thread-with-Event pattern. The fix should be gated on `sys.platform == 'win32'`.

**Effort:** S
**Priority:** P3
**Depends on:** Windows notify-send equivalent

---

## Completed

- ThreadingHTTPServer + _approval_lock (concurrent request serialization)
- select.select stdin timeout (replaced zombie-thread _timed_input)
- Revocation failures raise + warn
- Mobile approval path (push → Tailscale callback → threading.Event)
- Biometric gate on approval screen (expo-local-authentication)
- Full Expo app: pairing, home, approval screens with onboarding
