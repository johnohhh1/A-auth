"""A-Auth CLI — register agents, make requests, manage registry."""

import sys
import json
import argparse
import time
from datetime import datetime

import urllib.request
import urllib.error

from aauth.daemon.server import DEFAULT_PORT

BASE_URL = f"http://127.0.0.1:{DEFAULT_PORT}"


# ------------------------------------------------------------------ HTTP helpers

def _post(path: str, data: dict) -> dict:
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        BASE_URL + path,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            try:
                return json.loads(resp.read())
            except json.JSONDecodeError:
                print("Error: daemon returned malformed response", file=sys.stderr)
                sys.exit(1)
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read())
        except json.JSONDecodeError:
            print(f"Error: daemon returned malformed error response (HTTP {e.code})",
                  file=sys.stderr)
            sys.exit(1)
    except urllib.error.URLError:
        print("Error: A-Auth daemon is not running. Start it with: aauth daemon start")
        sys.exit(1)


def _get(path: str) -> dict:
    req = urllib.request.Request(BASE_URL + path)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            try:
                return json.loads(resp.read())
            except json.JSONDecodeError:
                print("Error: daemon returned malformed response", file=sys.stderr)
                sys.exit(1)
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read())
        except json.JSONDecodeError:
            print(f"Error: daemon returned malformed error response (HTTP {e.code})",
                  file=sys.stderr)
            sys.exit(1)
    except urllib.error.URLError:
        print("Error: A-Auth daemon is not running. Start it with: aauth daemon start")
        sys.exit(1)


def _ts(epoch: float) -> str:
    if not epoch:
        return "never"
    return datetime.fromtimestamp(epoch).strftime("%Y-%m-%d %H:%M:%S")


def _ago(epoch: float) -> str:
    if not epoch:
        return "never"
    delta = time.time() - epoch
    if delta < 60:
        return f"{int(delta)}s ago"
    if delta < 3600:
        return f"{int(delta/60)}m ago"
    if delta < 86400:
        return f"{int(delta/3600)}h ago"
    return f"{int(delta/86400)}d ago"


# ------------------------------------------------------------------ commands

def cmd_daemon(args):
    """Start the A-Auth daemon."""
    from aauth.daemon.server import run
    run()


def cmd_register(args):
    """Register an agent."""
    result = _post("/agents/register", {
        "agent_id": args.agent_id,
        "name": args.name,
        "description": args.description or "",
    })
    if "error" in result:
        print(f"Error: {result['error']}")
        sys.exit(1)
    print(f"Registered: {result['name']} ({result['agent_id']})")


def cmd_deregister(args):
    """Deregister an agent and revoke all its tokens."""
    result = _post(f"/agents/{args.agent_id}/deregister", {})
    if "error" in result:
        print(f"Error: {result['error']}")
        sys.exit(1)
    print(f"Deregistered agent: {args.agent_id}")


def cmd_list(args):
    """List all registered agents."""
    result = _get("/agents")
    agents = result.get("agents", [])
    if not agents:
        print("No agents registered.")
        return
    print(f"\n{'ID':<25} {'Name':<20} {'Last seen':<15}")
    print("-" * 62)
    for a in agents:
        print(f"{a['agent_id']:<25} {a['name']:<20} {_ago(a['last_seen']):<15}")
    print()


def cmd_request(args):
    """Request permission for a service action (for testing/manual use)."""
    scope = args.scope or "one_shot"
    ttl_map = {"one_shot": 0, "time_window": 900, "task": 14400}
    ttl = ttl_map.get(scope, 0)

    result = _post("/request", {
        "agent_id": args.agent_id,
        "service": args.service,
        "action": args.action,
        "scope": scope,
        "ttl_seconds": ttl,
    })

    if "error" in result:
        print(f"Denied: {result['error']}")
        sys.exit(1)

    print(f"\nApproved!")
    print(f"Token:   {result['token']}")
    print(f"Scope:   {result['scope']}")
    if result["expires_at"]:
        print(f"Expires: {_ts(result['expires_at'])}")
    else:
        print(f"Expires: one-shot (single use)")


def cmd_revoke(args):
    """Revoke all active tokens for an agent."""
    result = _post(f"/agents/{args.agent_id}/revoke", {})
    print(f"Revoked {result.get('revoked_tokens', 0)} token(s) for {args.agent_id}")


def cmd_tokens(args):
    """List active tokens for an agent."""
    result = _get(f"/agents/{args.agent_id}/tokens")
    tokens = result.get("tokens", [])
    if not tokens:
        print(f"No active tokens for {args.agent_id}")
        return
    print(f"\n{'Token (partial)':<20} {'Service':<15} {'Action':<15} {'Scope':<15} {'Expires'}")
    print("-" * 85)
    for t in tokens:
        exp = _ts(t["expires_at"]) if t["expires_at"] else "one-shot"
        print(f"{t['token']:<20} {t['service']:<15} {t['action']:<15} {t['scope']:<15} {exp}")
    print()


def cmd_activity(args):
    """Show recent activity log."""
    path = "/activity"
    if args.agent_id:
        path += f"?agent_id={args.agent_id}&limit={args.limit}"
    else:
        path += f"?limit={args.limit}"

    result = _get(path)
    events = result.get("activity", [])
    if not events:
        print("No activity recorded.")
        return
    print(f"\n{'Time':<20} {'Agent':<20} {'Service':<12} {'Action':<12} {'Outcome'}")
    print("-" * 80)
    for e in events:
        print(
            f"{_ts(e['ts']):<20} {e['agent_id']:<20} "
            f"{e['service']:<12} {e['action']:<12} {e['outcome']}"
        )
    print()


def cmd_validate(args):
    """Validate a token."""
    result = _post("/validate", {
        "token": args.token,
        "service": args.service,
        "action": args.action,
    })
    if result.get("valid"):
        print("Valid")
    else:
        print(f"Invalid: {result.get('reason', 'unknown')}")
        sys.exit(1)


def cmd_status(args):
    """Check daemon status."""
    result = _get("/health")
    if result.get("status") == "ok":
        print(f"Daemon running — version {result.get('version', '?')}")
    else:
        print("Daemon not running or unhealthy")
        sys.exit(1)


# ------------------------------------------------------------------ main

def main():
    parser = argparse.ArgumentParser(
        prog="aauth",
        description="A-Auth: Zero-trust credential proxy for AI agents",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # daemon
    p_daemon = sub.add_parser("daemon", help="Start the A-Auth daemon")
    p_daemon.set_defaults(func=cmd_daemon)

    # status
    p_status = sub.add_parser("status", help="Check daemon status")
    p_status.set_defaults(func=cmd_status)

    # register
    p_reg = sub.add_parser("register", help="Register an agent")
    p_reg.add_argument("agent_id", help="Unique agent identifier")
    p_reg.add_argument("name", help="Human-readable agent name")
    p_reg.add_argument("description", nargs="?", default="", help="Agent description")
    p_reg.set_defaults(func=cmd_register)

    # deregister
    p_dereg = sub.add_parser("deregister", help="Deregister an agent")
    p_dereg.add_argument("agent_id")
    p_dereg.set_defaults(func=cmd_deregister)

    # list
    p_list = sub.add_parser("list", help="List registered agents")
    p_list.set_defaults(func=cmd_list)

    # request
    p_req = sub.add_parser("request", help="Request a permission token")
    p_req.add_argument("agent_id")
    p_req.add_argument("service", help="e.g. gmail, sheets, slack")
    p_req.add_argument("action", help="e.g. read, write, send")
    p_req.add_argument("--scope", choices=["one_shot", "time_window", "task"],
                       default="one_shot")
    p_req.set_defaults(func=cmd_request)

    # revoke
    p_revoke = sub.add_parser("revoke", help="Revoke all tokens for an agent")
    p_revoke.add_argument("agent_id")
    p_revoke.set_defaults(func=cmd_revoke)

    # tokens
    p_tokens = sub.add_parser("tokens", help="List active tokens for an agent")
    p_tokens.add_argument("agent_id")
    p_tokens.set_defaults(func=cmd_tokens)

    # activity
    p_activity = sub.add_parser("activity", help="Show activity log")
    p_activity.add_argument("--agent-id", dest="agent_id", default=None)
    p_activity.add_argument("--limit", type=int, default=20)
    p_activity.set_defaults(func=cmd_activity)

    # validate
    p_validate = sub.add_parser("validate", help="Validate a token")
    p_validate.add_argument("token")
    p_validate.add_argument("service")
    p_validate.add_argument("action")
    p_validate.set_defaults(func=cmd_validate)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
