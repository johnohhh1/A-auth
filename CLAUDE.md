# A-Auth — Project Context for Claude Code

## Conversation history
The founding session JSONL is at:
`/home/johnohhh1/.claude/projects/-home-johnohhh1/0d1d897d-dee8-492e-8ded-7fdd645c6b53.jsonl`

A full narrative summary is in `SESSION_NOTES.md` in this repo.

---

## What this is
**A-Auth** — local-first zero-trust credential proxy for AI agents.

Agents running on a machine request access to services (GitHub, AWS, Stripe, etc.).
The request is gated by the user's phone: a push notification arrives, the user
authenticates with biometrics, and approves or denies. The agent gets a short-lived
token or gets blocked. Credentials never leave the local network.

**Core pitch:** "Your phone is the vault."
The product moment is: phone buzzes → fingerprint → agent gets access (or doesn't).
TTY approval is scaffolding. The app is the product.

---

## Sprint order (CEO pivot — critical)
1. **Sprint 1 (current):** React Native / Expo app talking to daemon over Tailscale.
   Ship the app BEFORE PyPI. A pip install without the mobile experience is just
   a CLI secret manager with extra steps — not the product.
2. **Sprint 2:** PyPI launch (`pip install aauth`) + MCP server (`uvx aauth-mcp`),
   `aauth audit` CLI command.
3. **Sprint 3:** TypeScript SDK (`aauth-sdk` npm package).

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  AI Agent (any language)                        │
│  uses aauth SDK / MCP tool                      │
└──────────────────┬──────────────────────────────┘
                   │ POST /request (localhost:7437)
┌──────────────────▼──────────────────────────────┐
│  aauth daemon  (Python, port 7437)              │
│  SQLite registry  ·  ThreadingHTTPServer        │
│  _approval_lock serializes TTY prompts          │
│  _phone / _pending_mobile for mobile path       │
└──────┬────────────────────────┬─────────────────┘
       │ push notification      │ direct Tailscale
       │ (Expo → APNs/FCM)      │ HTTP callback
┌──────▼────────────────────────▼─────────────────┐
│  A-Auth iOS/Android app  (Expo / React Native)  │
│  expo-router · expo-secure-store                │
│  expo-local-authentication (biometric gate)     │
│  expo-notifications (Expo push service)         │
│  Connects to daemon at 100.124.46.47:7437       │
└─────────────────────────────────────────────────┘
```

**Key design decisions:**
- Push notifications use Expo's cloud relay for *delivery only*
- The actual approve/deny callback (`POST /requests/{id}/respond`) goes directly
  over Tailscale — zero cloud dependency for the auth path
- If no phone is registered, daemon falls through to TTY prompt (backward compat)

---

## Repo structure

```
A-auth/
├── aauth/
│   ├── daemon/
│   │   ├── server.py      # ThreadingHTTPServer, all endpoints, mobile approval path
│   │   ├── notify.py      # TTY approval prompt (select.select stdin timeout)
│   │   └── push.py        # Expo push notification sender (stdlib urllib only)
│   ├── db/
│   │   └── registry.py    # SQLite token registry (timeout=10 for concurrent writes)
│   ├── sdk/
│   │   └── client.py      # Python SDK: PermissionChain, AAuthClient
│   └── cli/
│       └── __main__.py    # CLI: aauth daemon / aauth status / aauth revoke
├── app/                   # Expo React Native app
│   ├── app/
│   │   ├── _layout.tsx    # Expo Router stack, dark theme
│   │   ├── index.tsx      # Home: unpaired onboarding / pending approvals / activity
│   │   ├── pair.tsx       # Pair screen: step-by-step daemon setup + IP entry
│   │   └── approval/
│   │       └── [id].tsx   # Approval screen: biometric gate, countdown, approve/deny
│   ├── hooks/
│   │   ├── useDaemon.ts   # Typed API client for all daemon endpoints
│   │   └── useNotifications.ts  # Push permission + token + notification routing
│   ├── app.json           # EAS project ID: a8cfea40-7c8d-4fe0-aa94-9fd376f439e8
│   ├── eas.json           # Build profiles: development / preview / production
│   └── .npmrc             # legacy-peer-deps=true (required for EAS builds)
├── tests/
│   └── test_server.py     # pytest: concurrent requests, mobile approval, TTY, expiry
├── .github/
│   ├── workflows/
│   │   ├── ci.yml         # pytest on Python 3.11/3.12/3.13
│   │   └── release.yml    # tag → build → PyPI trusted publishing
│   └── CONTRIBUTING.md
├── README.md
├── CHANGELOG.md
├── TODOS.md               # P2: extract shared _post helper; P3: Windows select compat
└── SESSION_NOTES.md       # Full narrative of founding session
```

---

## Daemon API (port 7437)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check → `{"status":"ok"}` |
| POST | `/request` | Agent requests a token. Triggers mobile or TTY approval. |
| POST | `/validate` | Validate a token (agents call this before using credentials) |
| POST | `/consume` | Consume a one-shot token |
| POST | `/revoke` | Revoke a token by ID |
| GET | `/activity` | Recent approval log |
| GET | `/requests/pending` | All pending mobile approval requests |
| GET | `/phone` | Current registered phone info |
| POST | `/phone/register` | Register phone (expo_token + device_name) |
| POST | `/phone/unregister` | Unregister phone |
| POST | `/requests/{id}/respond` | Phone calls this to approve/deny (over Tailscale) |

---

## Running locally

```bash
# Start daemon
cd ~/A-auth
python -m aauth daemon

# Run tests
pytest tests/

# Start Expo Metro (phone must be on same Tailscale network)
cd ~/A-auth/app
REACT_NATIVE_PACKAGER_HOSTNAME=100.124.46.47 npx expo start

# Trigger a test agent request (daemon must be running)
python3 -c "
import aauth
with aauth.PermissionChain(agent_id='test', agent_name='Test') as chain:
    token = chain.request(service='github', action='read')
    print('approved:', token)
"
```

---

## EAS / Expo setup

- Expo account: `johnohhh1`
- EAS project ID: `a8cfea40-7c8d-4fe0-aa94-9fd376f439e8`
- EAS dashboard: https://expo.dev/accounts/johnohhh1/projects/a-auth
- Android build (development): `eas build --platform android --profile development`
- iOS build: **blocked** — Apple Developer Program ($99/yr) not enrolled.
  Use `--platform android` for now.
- `package.json` main: `expo-router/entry` (not index.ts — that was a bug)
- `.npmrc` has `legacy-peer-deps=true` because expo-dev-client pulls in
  react-dom@19.2.4 which requires react@^19.2.4 but expo pins react@19.2.0

---

## Machine context

- Tailscale IP: `100.124.46.47` (use this for phone ↔ daemon communication)
- Local IP: `10.0.0.140`
- GitHub repo: https://github.com/johnohhh1/A-auth
- SSH keys configured for GitHub push

---

## Key bugs fixed in founding session

1. **Mock target for tests**: `prompt_approval` is imported directly in server.py,
   so patch target is `"aauth.daemon.server.prompt_approval"` not
   `"aauth.daemon.notify.prompt_approval"`
2. **select.select stdin timeout**: Replaced thread-based `_timed_input` to eliminate
   zombie thread race condition
3. **ThreadingHTTPServer + _approval_lock**: Concurrent requests serialized via lock
4. **expo-router entry point**: `package.json` main must be `expo-router/entry`,
   not `index.ts` (which tried to import a non-existent App.tsx)
5. **react-dom missing**: Required by `@expo/log-box`, install explicitly
6. **package-lock.json sync**: EAS runs `npm ci` — lock file must be in sync

---

## TODOS (see TODOS.md for detail)

- **P2**: Extract shared `_post` HTTP helper before adding MCP server
- **P3**: Windows compatibility for `select.select` stdin (doesn't work on Windows)
- **Post-app**: PyPI trusted publishing setup at pypi.org, then re-run v0.1.0 release
