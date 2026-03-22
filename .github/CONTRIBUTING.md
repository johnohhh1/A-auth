# Contributing to A-Auth

## Setup

```bash
git clone https://github.com/johnohhh1/A-auth.git
cd A-auth
pip install -e .
pip install pytest
```

## Running tests

```bash
pytest
```

All 34 tests should pass. No external services or credentials required.

## Project structure

```
aauth/
  daemon/
    server.py     # HTTP daemon (ThreadingHTTPServer, port 7437)
    notify.py     # TTY approval prompt + desktop notification
  db/
    registry.py   # SQLite agent registry and token store
  sdk/
    client.py     # Python SDK (AAuth, TaskSession, PermissionChain)
  cli/
    __main__.py   # CLI entry point
tests/
  test_server.py  # HTTP integration tests
  test_registry.py # Registry unit tests
AAUTH_SKILL.md    # LLM-readable HTTP API reference
```

## Making changes

- Keep the daemon stdlib-only (no external dependencies)
- Add a test for every new codepath
- Update `AAUTH_SKILL.md` if the HTTP API changes

## E2E test (MCP path)

To verify the MCP integration manually:
1. Start the daemon: `aauth daemon`
2. Register a test agent: `aauth register test-agent "Test"`
3. In another terminal, POST to `/request` and verify the approval prompt appears
4. Approve and verify the token is returned

## Releasing

Push a tag: `git tag v0.x.0 && git push origin v0.x.0`

The release workflow runs tests, builds the wheel, and publishes to PyPI automatically.
