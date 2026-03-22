# A-Auth Skill — Agent Authentication Protocol

You are an AI agent with access to the A-Auth credential proxy running locally.
A-Auth lets you request authenticated access to services. You never touch credentials directly.
The user is prompted to approve every request via their terminal.

---

## Daemon endpoint

```
http://127.0.0.1:7437
```

All requests use JSON. All responses are JSON.

---

## Step 1: Check if you are registered

```
GET /health
```

If the daemon is not running, tell the user:
> "A-Auth daemon is not running. Start it with: `aauth daemon`"

---

## Step 2: Register yourself (once per agent)

If you don't have an `agent_id`, pick a descriptive one like `claude-code-johnohhh1`.

```
POST /agents/register
{
  "agent_id": "YOUR_AGENT_ID",
  "name": "Human-readable name",
  "description": "What this agent does"
}
```

Response `201`:
```json
{"agent_id": "...", "name": "...", "registered_at": 1234567890.0}
```

If you get `{"error": "agent not registered"}` on any other call, register first.

---

## Step 3: Request a permission token

```
POST /request
{
  "agent_id": "YOUR_AGENT_ID",
  "service": "gmail",
  "action": "read",
  "scope": "one_shot",
  "ttl_seconds": 0
}
```

**This blocks until the user approves or denies.** The user will see a prompt in their terminal.

**Scope options:**

| scope | ttl_seconds | When to use |
|-------|------------|-------------|
| `one_shot` | 0 | Single action (safest) |
| `time_window` | 900 | Need repeated access for ~15 min |
| `task` | 14400 | Multi-step task, need access throughout |

Response `200` (approved):
```json
{
  "token": "aauth_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "scope": "one_shot",
  "ttl_seconds": 0,
  "expires_at": 0
}
```

Response `403` (denied):
```json
{"error": "request denied by user"}
```

If denied: do NOT retry automatically. Tell the user the request was denied and ask if they want to try again.

---

## Step 4: Use the token

The token is YOUR proof that the user approved this action. Include it in your tool calls or
pass it to your integration code as proof of authorization.

**The token does not give you credentials.** In v0.1, the token is proof of user approval
that your code can check. Full credential proxying (phone makes the API call) is v0.2+.

---

## Step 5: Validate a token (before using it)

```
POST /validate
{
  "token": "aauth_xxx",
  "service": "gmail",
  "action": "read"
}
```

Response: `{"valid": true}` or `{"valid": false, "reason": "token expired"}`

---

## Step 6: Consume a one-shot token (after use)

```
POST /consume
{"token": "aauth_xxx"}
```

Call this after you have completed the action the token authorized.

---

## Other useful endpoints

```
GET /agents                          — list all registered agents
GET /agents/{agent_id}/tokens        — list active tokens for an agent
POST /agents/{agent_id}/revoke       — revoke all tokens for an agent
GET /activity?agent_id=X&limit=20    — activity log
```

---

## Error handling rules

1. **403 agent not registered** → register, then retry the original request
2. **403 request denied** → do NOT retry. Inform the user. Ask before trying again.
3. **connection refused** → daemon is not running. Tell the user.
4. **token expired / already used** → request a new token. Do NOT use expired tokens.

---

## Example flow

```python
import urllib.request, json

BASE = "http://127.0.0.1:7437"

def aauth_post(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(BASE + path, data=body,
          headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read())

# Register (idempotent)
aauth_post("/agents/register", {
    "agent_id": "my-research-agent",
    "name": "Research Agent",
    "description": "Reads Gmail inbox for research summaries"
})

# Request approval
result = aauth_post("/request", {
    "agent_id": "my-research-agent",
    "service": "gmail",
    "action": "read",
    "scope": "time_window",
    "ttl_seconds": 900
})

token = result["token"]
print(f"Approved! Token: {token}")

# ... do your work ...

# Consume if one-shot
# aauth_post("/consume", {"token": token})
```

---

## Important constraints

- **Never cache or store tokens beyond their TTL.** Always validate before use.
- **Never request broader scope than needed.** Use `one_shot` by default.
- **One request at a time.** Do not make parallel `/request` calls — they queue at the user's terminal.
- **Permission chains** (needing multiple services): request them sequentially, not in parallel. Each generates a separate prompt. In v0.2, bundled chain approvals will be supported.
