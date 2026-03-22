# Changelog

## v0.1.0 (2026-04-28)

First public release — the open-source alternative to Okta's agent auth.

### What's new

- **Approval-gated tokens** — agents request permission; you approve at your terminal with a single keypress. Every credential access requires your explicit sign-off.
- **Three token scopes** — `one_shot` (single use), `time_window` (N minutes), and `task` (until context exits). Use the shortest scope that fits your workflow.
- **Python SDK** — `AAuth.request()`, `AAuth.window()`, `AAuth.task()`, and `PermissionChain` for multi-service access.
- **CLI** — `aauth daemon`, `aauth register`, `aauth request`, `aauth revoke`, `aauth tokens`, `aauth activity`, and more.
- **AAUTH_SKILL.md** — drop this file into any LLM agent's context and it can use A-Auth over plain HTTP — no SDK required.
- **Local-first** — daemon runs on `127.0.0.1:7437`, backed by SQLite. Zero cloud dependency, zero telemetry.
- **Concurrent-safe** — approval prompts serialize cleanly when multiple agents request access at the same time.
