# TODOS

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

