# A-Auth: Agent Authentication Protocol

**Product Requirements Document — DRAFT v0.1**
**Author:** JohnO | **Date:** 2026-03-22

---

## One-Liner

Zero-trust credential proxy for AI agents — secrets never leave your device, agents never touch your keys.

## The Problem

AI agents are proliferating. Every developer is running multiple agents across frameworks (Claude Code, Ollama, n8n, custom scripts), and every agent needs access to authenticated services (email, calendars, APIs, databases). Today this means:

1. **Secrets in .env files** — plaintext credentials sitting on disk, copied across machines, committed to repos accidentally, available to any process.
2. **No permission scoping** — an agent that needs to *read* your email gets the same OAuth token that can *send* as you, *delete* your inbox, and *access* your Drive.
3. **No approval flow** — agents either have full access or no access. No middle ground. No "ask me first."
4. **No agent registry** — nobody knows how many agents are running, what they can access, or when they last did something. (See: Dependabot running for months on a dead repo.)
5. **Cloud vaults are honeypots** — centralized secret managers are high-value targets. One breach = every user's credentials.

## The Solution

A-Auth is a local-first credential proxy with biometric approval. Your phone is the vault. Agents request permission through a lightweight protocol. You approve via push notification + biometric. The agent gets the *result* of an authenticated API call — never the credential itself.

### Core Principles

- **Local-first**: All secrets stored in an encrypted database on your phone. Nothing in the cloud.
- **Zero-knowledge relay**: The transport layer (Tailscale mesh or optional relay server) never sees credentials.
- **Skill-as-integration**: Agents learn the A-Auth protocol by reading a skill document. No SDK required for basic usage.
- **Agent registry by default**: If an agent isn't registered, it can't request anything. Fleet visibility is a side effect of auth.
- **Open source core**: SDK, relay, and protocol spec are MIT-licensed. Mobile app is open core.

---

## Architecture

### Components

| Component | Description | Runs On | License |
|-----------|-------------|---------|---------|
| **A-Auth Skill** | Markdown doc that teaches any LLM-based agent the A-Auth protocol | Agent context | MIT |
| **A-Auth SDK** | Python/JS library for programmatic integration | Agent host | MIT |
| **A-Auth Mobile App** | Vault + approval UI + agent registry + activity feed | Phone (iOS/Android) | Open Core |
| **Policy Engine** | Declarative YAML/JSON rules for auto-approval | Phone (local) | MIT |
| **Relay** (optional) | Stateless message broker for non-Tailscale users | Self-hosted / hosted | MIT |

### Data Flow

```
Agent hits tool boundary
    → SDK/Skill sends permission request over Tailscale
        → A-Auth app receives push notification
            → User biometric confirms
                → Policy engine evaluates scope
                    → Phone makes authenticated API call (Option A)
                    → OR phone mints ephemeral scoped token (Option B)
                        → Result returns to agent
                            → Token self-destructs per scope rules
```

### Credential Proxy Models

**Option A — Phone Proxy (Default, Most Secure)**
Phone holds master credential, makes the API call directly, returns only the result to the agent. Agent never touches any credential material. Phone must be online.

**Option B — Ephemeral Token Mint**
Phone holds master credential, derives a short-lived scoped token, sends token to agent. Agent makes API call directly. Token self-destructs per TTL. Better latency, requires API support for scoped token derivation.

### Transport Layer

**Primary: Tailscale**
Agent host and phone are nodes on the same Tailscale mesh network. Direct WireGuard tunnel. No cloud infrastructure needed. Sub-second latency for pre-approved requests.

**Fallback: Relay Server**
For users without Tailscale. Stateless WebSocket broker. Passes encrypted request/response envelopes. Never decrypts. Never stores. Self-hostable or Anthropic-hosted option.

**Key insight**: If the relay is breached, the attacker gets encrypted message envelopes with no keys to decrypt them. The credential material never transits the relay.

---

## Token Types

| Type | TTL | Use Case | Risk |
|------|-----|----------|------|
| **One-Shot** | Single API call | Sensitive one-off actions (send email, delete file) | Low |
| **Time-Windowed** | 5 / 15 / 60 min | Research tasks, batch reads | Medium |
| **Task-Scoped** | Until `task.complete()` (4hr hard ceiling) | Multi-step workflows | Medium |
| **Chain** | Multi-service, one approval | Agent needs Gmail + Sheets + Calendar for one workflow | Medium-High |
| **Standing** | Persistent (revocable) | Always-on read access to calendar, etc. | High (full audit) |

### Permission Chains

When an agent needs multiple services for one task, A-Auth bundles them into a single approval. User sees: "ResearchBot wants to: read Gmail inbox, write to Google Sheets, read Calendar — approve this workflow?" One biometric, multiple scoped grants. Each service gets its own token with independent TTLs.

---

## Agent Registry

### How It Works

Every agent that wants to use A-Auth must register with an `agent_id`, a human-readable name, and a description. Registration happens once. Unregistered agents cannot request permissions — there is no credential to proxy because the vault doesn't know they exist.

### Registry Features

- **Fleet dashboard**: See all registered agents, their last activity, active permissions, and status
- **Per-agent kill switch**: Revoke all permissions for any agent instantly
- **Activity feed**: Real-time log of what each agent is doing with its permissions
- **Anomaly alerts**: "ResearchBot made 500 email reads in the last hour" (configurable thresholds)
- **Zombie detection**: Agents that haven't checked in for N days get flagged for review/deregistration

### The Dependabot Problem

A-Auth solves agent sprawl by making registration mandatory. Open the app → see everything that's running → kill what shouldn't be. No more forgotten bots burning cycles on dead repos.

---

## Policy Engine

Declarative rules that live on-device (YAML/JSON). Evaluated locally before prompting the user.

```yaml
# a-auth-policy.yaml
policies:
  - agent: "research-bot"
    rules:
      - service: gmail
        action: read
        decision: auto_approve
        scope: time_window
        ttl: 15m

      - service: gmail
        action: send
        decision: prompt_user
        scope: one_shot

      - service: "*"
        action: "*"
        decision: deny
        after_hours: true  # 11pm-6am = no agent activity

  - agent: "*"
    rules:
      - service: "*"
        action: read
        decision: prompt_user

      - service: "*"
        action: write
        decision: prompt_user
        require_biometric: true

defaults:
  unregistered_agent: deny
  timeout_seconds: 60
  timeout_behavior: queue  # queue | skip | deny
```

---

## Skill-as-Distribution

### The Key Insight

MCP requires npm/Docker setup. A-Auth's basic integration is a markdown file.

Drop `AAUTH_SKILL.md` into any agent's context. The agent reads it, understands the protocol (HTTP calls over Tailscale), and starts making A-Auth requests. No SDK, no package manager, no build step.

This makes A-Auth:
- **Model-agnostic**: Claude, GPT, Gemini, local Ollama — if it reads markdown and makes HTTP calls, it works
- **Framework-agnostic**: LangChain, CrewAI, AutoGen, raw scripts — doesn't matter
- **Auditable**: The skill IS the documentation. Hand it to Claude and say "red team this"

### SDK for Power Users

```python
from aauth import AAuth

aa = AAuth(agent_id="research-bot")

# One-shot read
result = aa.request("gmail", "read", scope="inbox/recent")

# Time-windowed access
with aa.window("gmail", "read", ttl="15m") as session:
    emails = session.list_inbox()
    for email in emails:
        content = session.read(email.id)

# Permission chain
with aa.chain(["gmail:read", "sheets:write"]) as chain:
    data = chain.gmail.read_inbox()
    chain.sheets.append("Sheet1", data)

# Task-scoped
async with aa.task("daily-digest") as task:
    # Token lives until task.complete()
    emails = await task.gmail.read_inbox()
    summary = await task.process(emails)
    await task.sheets.write(summary)
    # Token dies here
```

---

## Mobile App — Feature Map

### Home Screen
- Agent fleet overview (registered agents, status, last active)
- Active permission count
- Quick kill-all button

### Agent Detail
- Agent name, ID, description
- Active tokens and their TTLs
- Permission history (last 7/30/90 days)
- Per-agent kill switch
- Per-agent policy overrides

### Approval Flow
- Push notification with agent name + requested service + action
- Scope selector (one-shot / time window / task / chain)
- Biometric confirmation
- "Also approve for next 15 minutes" quick option

### Activity Feed
- Real-time stream of all agent API calls
- Filterable by agent, service, time
- Anomaly highlights

### Policy Editor
- Visual rule builder (or raw YAML editor for power users)
- Import/export policy files
- Community policy templates

### Settings
- Tailscale network config
- Vault management (add/remove/rotate credentials)
- Backup encrypted vault (to local file, never cloud)
- Notification preferences
- Auto-lock timeout

---

## Security Model

### Threat Scenarios

| Threat | Mitigation |
|--------|------------|
| Cloud server breach | No secrets in cloud. Relay is zero-knowledge. Nothing to steal. |
| Agent prompt injection tries to exfiltrate creds | Agent never has credentials. Can only request proxied results. |
| Rogue agent on network | Must be registered. Unregistered = denied. |
| Phone lost/stolen | Biometric gate + encrypted vault. Remote wipe via Tailscale ACL removal. |
| MITM on relay | Tailscale = WireGuard encryption. Relay option = E2E encrypted envelopes. |
| Credential sprawl | All creds in one vault. Single audit point. Rotation reminders. |
| Forgotten agents | Registry + zombie detection + activity alerts. |

### What A-Auth Is NOT

- Not a password manager (though it holds API keys/OAuth tokens)
- Not an identity provider (it proxies existing identities)
- Not a replacement for OAuth (it sits on top of OAuth and adds agent-specific scoping)

---

## Technical Stack (Proposed)

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Mobile App | React Native / Expo | Cross-platform, fast iteration |
| Local Vault | SQLCipher | Encrypted SQLite, proven, audited |
| Transport | Tailscale (primary), WebSocket (fallback) | Zero-config mesh, WireGuard encryption |
| SDK | Python + JS/TS | Covers 90% of agent developers |
| Policy Engine | YAML parser + rule evaluator | Simple, auditable, version-controllable |
| Skill Doc | Markdown | Universal, model-agnostic |

---

## Milestones

### v0.1 — Proof of Concept
- [ ] A-Auth Skill document (markdown protocol spec)
- [ ] Python SDK (basic request/approve flow)
- [ ] CLI approval tool (desktop, pre-mobile)
- [ ] SQLCipher vault (local encrypted store)
- [ ] Tailscale transport
- [ ] One-shot and time-windowed tokens

### v0.2 — Mobile MVP
- [ ] React Native app (iOS + Android)
- [ ] Push notification approval flow
- [ ] Biometric gate
- [ ] Agent registry + fleet dashboard
- [ ] Activity feed

### v0.3 — Policy Engine
- [ ] YAML policy spec
- [ ] Auto-approve rules
- [ ] Permission chains
- [ ] Task-scoped tokens
- [ ] Anomaly detection (basic threshold alerts)

### v0.4 — Hardening
- [ ] Security audit (external)
- [ ] Penetration testing
- [ ] Credential rotation management
- [ ] Backup/restore vault
- [ ] Standing permissions with rate limiting

### v1.0 — Public Release
- [ ] SDK stable API
- [ ] Mobile app on App Store / Play Store
- [ ] Documentation site
- [ ] Community policy templates
- [ ] Self-hosted relay Docker image

---

## Business Model

| Tier | Price | Features |
|------|-------|----------|
| **Personal** | Free | 5 agents, basic policies, single user |
| **Pro** | $9/mo | Unlimited agents, advanced policies, priority support |
| **Team** | $29/mo/seat | Shared org policies, team agent registry, admin controls, audit export |
| **Enterprise** | Custom | SSO, SOC2 compliance, dedicated support, SLA |

**Open source components are always free.** Monetization is on the mobile app's team/enterprise features.

---

## Competitive Landscape

| Solution | Why It's Not Enough |
|----------|-------------------|
| HashiCorp Vault | Cloud-hosted, enterprise-heavy, not agent-aware, no approval flows |
| 1Password Service Accounts | Static secrets, no dynamic scoping, no agent registry |
| AWS IAM / GCP Service Accounts | Cloud-only, not local-first, no biometric approval |
| OAuth scopes | Too coarse, no time-boxing, no per-agent differentiation |
| .env files | Plaintext, no scoping, no approval, no audit trail |
| MCP auth | Protocol-level, not credential management, limited to MCP-aware clients |

**A-Auth's differentiator: local-first vault + biometric approval + skill-based distribution + agent registry as emergent property.**

---

## Open Questions

1. **React Native vs Flutter vs Native?** RN/Expo is fastest to market. Flutter has better performance. Native is most secure but 2x dev effort.
2. **Vault backup strategy?** Encrypted local backup is safe. Cloud backup (even encrypted) introduces trust surface. Let user choose?
3. **Option A vs B default?** Phone proxy is more secure but adds latency and requires phone online. Ephemeral tokens are faster but not all APIs support scoped derivation. Probably both, let policy engine decide per-service.
4. **How to handle agent re-registration?** If an agent's host changes (new machine, container restart), does it get a new ID or re-auth the old one? Need a device attestation story.
5. **Offline mode?** If phone is offline, should standing permissions still work via cached tokens on agent side? Security vs usability tradeoff.
6. **Multi-user?** Family/team sharing a vault? Separate vaults with shared policies? v2 problem.

---

*"I had a bot running for months I forgot about. It was harmless. Next time it won't be."*

*That's why A-Auth exists.*
