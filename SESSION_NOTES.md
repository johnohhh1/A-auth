# A-Auth — Session Notes (2026-03-22)

## What we built

A-Auth is a **zero-trust credential proxy for AI agents**. Your phone/terminal is the
vault. Every time an agent needs to access Gmail, Slack, or any service, it asks A-Auth
for permission. You approve or deny. The agent gets a short-lived token. Your actual
credentials never touch the agent.

---

## What we did today

### 1. Fixed gstack skill symlinks

`/plan-ceo-review` and other gstack skills weren't resolving — they fell through to the
base `/gstack` command. Root cause: the `setup` script failed on Ubuntu 26.04 because
Playwright doesn't support it yet. We manually ran the symlink creation logic and linked
25 skills into `~/.claude/skills/`.

### 2. `/plan-ceo-review` — SCOPE EXPANSION mode

Ran a full CEO review on the A-Auth project. Mode: SCOPE EXPANSION.

**Scope decisions:**

| # | Proposal | Decision | Notes |
|---|----------|----------|-------|
| 1 | Public OSS launch by April 28 | ACCEPTED | Beat Okta's April 30 announcement |
| 2 | MCP Server (Sprint 2) | ACCEPTED | `uvx aauth-mcp`, progress notifications for blocking /request |
| 3 | TypeScript SDK (Sprint 3) | ACCEPTED | `npm install aauth-sdk` |
| 4 | `aauth audit` CLI command | ACCEPTED | Table view of activity log |
| 5 | AAUTH_SPEC.md protocol spec | DEFERRED | YAGNI — write after v0.1 API stabilizes |

**Sprint calendar:**
- Sprint 1: April 28 — OSS launch (README, CI, PyPI)
- Sprint 2: May 12 — MCP server + `aauth audit`
- Sprint 3: May 26 — TypeScript SDK

CEO plan saved to `~/.gstack/projects/A-auth/ceo-plans/2026-03-22-agent-auth-protocol.md`.
Went through 2 adversarial review rounds (5/10 → 7/10).

### 3. `/plan-eng-review` — Architecture review

Ran a full eng review. All 4 issues resolved.

**Decisions made:**

| # | Issue | Fix chosen |
|---|-------|------------|
| 1 | Single-threaded daemon — blocks on approval, rejects concurrent agents | `ThreadingHTTPServer` + module-level `_approval_lock` serializes prompts |
| 2 | `_timed_input` thread leak — zombie thread races next prompt's stdin | Replaced thread with `select.select([sys.stdin], [], [], timeout)` |
| 3 | Silent revocation failure — `except Exception: pass` on security-critical path | Log warning + re-raise from `_revoke_all` and `PermissionChain.__exit__` |
| 4 | Test gaps — no tests for concurrent requests, timeout, malformed JSON, expired tokens | Added all 4 test groups (34 tests total, all passing) |

**Obvious fixes (no debate):**
- `_read_body` silently returned `{}` on malformed JSON → now returns 400
- `sdk/client.py` and `cli/__main__.py` didn't catch `json.JSONDecodeError` on responses → fixed
- `sqlite3.connect()` had no timeout → added `timeout=10` for concurrent write safety

**TODOs captured in `TODOS.md`:**
- Extract shared `_post` HTTP helper before MCP server ships (Sprint 2 will add a 3rd copy)
- Windows support for `select.select` (A-Auth is Linux/Mac for now, note for future porters)

### 4. Implementation — all fixes shipped

Every decision from the eng review was implemented and tested:

```
aauth/daemon/server.py   ThreadingHTTPServer + _approval_lock + 400 on bad JSON
aauth/daemon/notify.py   select.select replaces thread-based _timed_input
aauth/db/registry.py     sqlite3.connect timeout=10
aauth/sdk/client.py      JSONDecodeError handling + revocation raises on failure
aauth/cli/__main__.py    JSONDecodeError handling in _post and _get
tests/test_server.py     4 new tests (34 total)
```

### 5. Sprint 1 deliverables — shipped

| File | What |
|------|------|
| `README.md` | One-liner, install, quickstart, CLI reference, architecture diagram |
| `.github/workflows/ci.yml` | pytest on Python 3.11/3.12/3.13 on every push/PR |
| `.github/workflows/release.yml` | Tag push → tests → build → PyPI (trusted publishing) |
| `CHANGELOG.md` | v0.1.0 entry |
| `.github/CONTRIBUTING.md` | Setup, project structure, release instructions |

### 6. Pushed to GitHub

```
https://github.com/johnohhh1/A-auth
```

- Main branch pushed ✓
- Tag `v0.1.0` pushed ✓ — release workflow triggered

---

## What we are about to do

### Immediate: unblock PyPI publish

The `v0.1.0` tag is pushed and the release workflow is running at:
`https://github.com/johnohhh1/A-auth/actions`

The publish step will fail until PyPI is configured. Pick one:

**Option A — Trusted publishing (no token, recommended):**
1. Go to https://pypi.org/manage/account/publishing/
2. Add publisher: owner `johnohhh1`, repo `A-auth`, workflow `release.yml`, environment `pypi`
3. Re-run the failed workflow job

**Option B — API token:**
1. https://pypi.org/manage/account/token/ → create token scoped to `aauth`
2. https://github.com/johnohhh1/A-auth/settings/secrets/actions → add `PYPI_API_TOKEN`
3. Edit `release.yml` to use `password: ${{ secrets.PYPI_API_TOKEN }}`
4. Re-tag or re-run the workflow

### Sprint 1 done criteria (checklist)

- [ ] `pip install aauth==0.1.0` works from PyPI
- [ ] CI badge is green on README
- [ ] `AAUTH_SKILL.md` review pass — verify it matches current daemon API
- [ ] HN post draft ready: _"A-Auth: open-source credential proxy for AI agents — your phone is the vault, agents never see your keys"_
- [ ] Publish to PyPI April 28, HN post April 28–29 (before Okta April 30)

### Sprint 2 — MCP Server + `aauth audit` (target: May 12)

Next up after launch:

- `aauth-mcp` package — MCP server wrapping the daemon
  - Tools: `aauth_request`, `aauth_validate`, `aauth_consume`, `aauth_list_agents`, `aauth_activity`
  - Blocking call handling: MCP progress notifications (Claude Desktop), 25s hard-fail for others
  - Packaging: `uvx aauth-mcp`
- `aauth audit` CLI command — table of agent | service | action | outcome | timestamp
  - Filters: `--agent`, `--service`, `--since` (default 30 days)
- Extract shared `_post` HTTP helper (TODOS.md item — do before MCP adds a 3rd copy)

### Sprint 3 — TypeScript SDK (target: May 26)

- `aauth-sdk` npm package
- Instance-method pattern: `const aa = new AAuth({ agentId: 'my-agent' })`
- Covers `request()`, `window()`, `task()`, `chain()`
- TypeScript types for all request/response shapes
- Update `AAUTH_SKILL.md` to include TS SDK example

---

## Key files

| File | Purpose |
|------|---------|
| `aauth/daemon/server.py` | HTTP daemon — routes, handlers, threading |
| `aauth/daemon/notify.py` | TTY approval prompt + desktop notification |
| `aauth/db/registry.py` | SQLite agent registry and token store |
| `aauth/sdk/client.py` | Python SDK |
| `aauth/cli/__main__.py` | CLI entry point |
| `AAUTH_SKILL.md` | LLM-readable HTTP API — drop into any agent's context |
| `A-AUTH_PRD.md` | Full product spec |
| `TODOS.md` | Tracked deferred work |
| `~/.gstack/projects/A-auth/ceo-plans/2026-03-22-agent-auth-protocol.md` | CEO plan |

## Review status

```
+====================================================================+
| Review          | Status    | Issues  |
|-----------------|-----------|---------|
| CEO Review      | CLEAN     | 5 proposals, 5 accepted |
| Eng Review      | CLEAN     | 4 issues, all fixed, 0 gaps |
| Design Review   | not run   | n/a (no UI) |
+====================================================================+
| VERDICT: CLEARED — ready for Sprint 2
+====================================================================+
```
