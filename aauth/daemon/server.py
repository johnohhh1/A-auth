"""A-Auth daemon — HTTP server that handles agent permission requests."""

import json
import secrets
import time
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from typing import Any
from urllib.parse import urlparse, parse_qs

from aauth.db import registry
from aauth.daemon.notify import prompt_approval
from aauth.daemon.push import send_push

DEFAULT_PORT = 7437  # AAUT in leet — memorable

# Serializes approval prompts so only one fires at a time.
# Without this, concurrent agent requests would interleave TTY output.
_approval_lock = threading.Lock()

# Phone registration: one phone per daemon instance (v0.1).
# { "expo_token": str, "device_name": str }
_phone: dict | None = None
_phone_lock = threading.Lock()

# Pending mobile approvals: request_id -> {"event": Event, "approved": bool | None}
#
#   PENDING REQUEST LIFECYCLE
#
#   agent                daemon               phone
#     |                    |                    |
#     |-- POST /request --> |                    |
#     |                    |-- push notif -----> |
#     |                    |  (blocks here)      |
#     |                    | <-- POST /requests/{id}/respond --|
#     |<-- token or 403 ---|                    |
#
_pending_mobile: dict[str, dict] = {}
_pending_mobile_lock = threading.Lock()


class AAuthHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):  # silence default access log
        pass

    # ------------------------------------------------------------------ routing

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self._json(200, {"status": "ok", "version": "0.1.0"})
        elif path == "/agents":
            self._handle_list_agents()
        elif path.startswith("/agents/") and path.endswith("/tokens"):
            agent_id = path.split("/")[2]
            self._handle_agent_tokens(agent_id)
        elif path == "/activity":
            self._handle_activity()
        elif path == "/requests/pending":
            self._handle_pending_requests()
        elif path == "/phone":
            self._handle_phone_status()
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._read_body()
        if body is None:
            self._json(400, {"error": "invalid JSON body"})
            return

        if path == "/agents/register":
            self._handle_register(body)
        elif path == "/request":
            self._handle_request(body)
        elif path == "/validate":
            self._handle_validate(body)
        elif path == "/consume":
            self._handle_consume(body)
        elif path.startswith("/agents/") and path.endswith("/revoke"):
            agent_id = path.split("/")[2]
            self._handle_revoke(agent_id)
        elif path.startswith("/agents/") and path.endswith("/deregister"):
            agent_id = path.split("/")[2]
            self._handle_deregister(agent_id)
        elif path == "/phone/register":
            self._handle_phone_register(body)
        elif path == "/phone/unregister":
            self._handle_phone_unregister()
        elif path.startswith("/requests/") and path.endswith("/respond"):
            request_id = path.split("/")[2]
            self._handle_respond(request_id, body)
        else:
            self._json(404, {"error": "not found"})

    # ------------------------------------------------------------------ handlers

    def _handle_register(self, body: dict) -> None:
        agent_id = body.get("agent_id", "").strip()
        name = body.get("name", "").strip()
        description = body.get("description", "").strip()

        if not agent_id or not name:
            self._json(400, {"error": "agent_id and name are required"})
            return

        agent = registry.register_agent(agent_id, name, description)
        self._json(201, {
            "agent_id": agent.agent_id,
            "name": agent.name,
            "registered_at": agent.registered_at,
        })

    def _handle_list_agents(self) -> None:
        agents = registry.list_agents()
        self._json(200, {"agents": [
            {
                "agent_id": a.agent_id,
                "name": a.name,
                "description": a.description,
                "registered_at": a.registered_at,
                "last_seen": a.last_seen,
            }
            for a in agents
        ]})

    def _handle_request(self, body: dict) -> None:
        agent_id = body.get("agent_id", "").strip()
        service = body.get("service", "").strip()
        action = body.get("action", "").strip()
        scope = body.get("scope", "one_shot").strip()
        ttl_seconds = int(body.get("ttl_seconds", _default_ttl(scope)))

        if not agent_id or not service or not action:
            self._json(400, {"error": "agent_id, service, action are required"})
            return

        agent = registry.get_agent(agent_id)
        if not agent:
            self._json(403, {
                "error": "agent not registered",
                "hint": "Register with POST /agents/register first",
            })
            return

        registry.touch_agent(agent_id)

        # Route to mobile approval if a phone is paired, otherwise TTY.
        with _phone_lock:
            phone = _phone.copy() if _phone else None

        if phone:
            approved, scope_override = self._mobile_approval(
                phone, agent_id, agent.name, service, action, scope, ttl_seconds
            )
        else:
            # Serialize TTY prompts — only one fires at a time.
            with _approval_lock:
                approved, scope_override = prompt_approval(
                    agent_id=agent_id,
                    agent_name=agent.name,
                    service=service,
                    action=action,
                    scope=scope,
                    ttl_seconds=ttl_seconds,
                )

        if not approved:
            registry.log_activity(agent_id, service, action, None, "denied")
            self._json(403, {"error": "request denied by user"})
            return

        if scope_override:
            parts = scope_override.split(":")
            scope = parts[0]
            ttl_seconds = int(parts[1]) if len(parts) > 1 else ttl_seconds

        tok = registry.mint_token(agent_id, service, action, scope, ttl_seconds)
        registry.log_activity(agent_id, service, action, tok.token, "approved")

        self._json(200, {
            "token": tok.token,
            "scope": scope,
            "ttl_seconds": ttl_seconds,
            "expires_at": tok.expires_at,
        })

    def _mobile_approval(
        self,
        phone: dict,
        agent_id: str,
        agent_name: str,
        service: str,
        action: str,
        scope: str,
        ttl_seconds: int,
        timeout: int = 60,
    ) -> tuple[bool, str | None]:
        """
        Send a push notification and block until the phone responds or timeout.

        Returns (approved, scope_override) — same shape as prompt_approval().
        """
        request_id = secrets.token_urlsafe(12)
        event = threading.Event()
        entry: dict = {"event": event, "approved": None, "scope_override": None,
                       "agent_id": agent_id, "agent_name": agent_name,
                       "service": service, "action": action, "scope": scope,
                       "ttl_seconds": ttl_seconds, "created_at": time.time()}

        with _pending_mobile_lock:
            _pending_mobile[request_id] = entry

        try:
            send_push(
                expo_token=phone["expo_token"],
                title=f"{agent_name} requests access",
                body=f"{service} · {action}",
                data={
                    "request_id": request_id,
                    "agent_id": agent_id,
                    "agent_name": agent_name,
                    "service": service,
                    "action": action,
                    "scope": scope,
                },
            )

            event.wait(timeout=timeout)

            approved = entry.get("approved")
            if approved is None:
                return False, None  # timed out
            return bool(approved), entry.get("scope_override")
        finally:
            with _pending_mobile_lock:
                _pending_mobile.pop(request_id, None)

    def _handle_respond(self, request_id: str, body: dict) -> None:
        with _pending_mobile_lock:
            entry = _pending_mobile.get(request_id)

        if not entry:
            self._json(404, {"error": "request not found or already resolved"})
            return

        approved = body.get("approved")
        if approved is None:
            self._json(400, {"error": "approved (bool) is required"})
            return

        entry["approved"] = bool(approved)
        entry["scope_override"] = body.get("scope_override")
        entry["event"].set()
        self._json(200, {"ok": True})

    def _handle_pending_requests(self) -> None:
        now = time.time()
        with _pending_mobile_lock:
            pending = [
                {
                    "request_id": rid,
                    "agent_id": e["agent_id"],
                    "agent_name": e["agent_name"],
                    "service": e["service"],
                    "action": e["action"],
                    "scope": e["scope"],
                    "created_at": e["created_at"],
                    "expires_in": max(0, 60 - int(now - e["created_at"])),
                }
                for rid, e in _pending_mobile.items()
            ]
        self._json(200, {"pending": pending})

    def _handle_phone_register(self, body: dict) -> None:
        global _phone
        expo_token = body.get("expo_token", "").strip()
        device_name = body.get("device_name", "unknown").strip()

        if not expo_token:
            self._json(400, {"error": "expo_token is required"})
            return

        with _phone_lock:
            _phone = {"expo_token": expo_token, "device_name": device_name}

        print(f"\n📱 Phone paired: {device_name}", flush=True)
        self._json(200, {"paired": True, "device_name": device_name})

    def _handle_phone_unregister(self) -> None:
        global _phone
        with _phone_lock:
            name = _phone["device_name"] if _phone else None
            _phone = None
        if name:
            print(f"\n📱 Phone unpaired: {name}", flush=True)
        self._json(200, {"unpaired": True})

    def _handle_phone_status(self) -> None:
        with _phone_lock:
            if _phone:
                self._json(200, {"paired": True, "device_name": _phone["device_name"]})
            else:
                self._json(200, {"paired": False})

    def _handle_validate(self, body: dict) -> None:
        token = body.get("token", "").strip()
        service = body.get("service", "").strip()
        action = body.get("action", "").strip()

        if not token or not service or not action:
            self._json(400, {"error": "token, service, action are required"})
            return

        valid, reason = registry.validate_token(token, service, action)
        if valid:
            self._json(200, {"valid": True})
        else:
            self._json(403, {"valid": False, "reason": reason})

    def _handle_consume(self, body: dict) -> None:
        token = body.get("token", "").strip()
        if not token:
            self._json(400, {"error": "token is required"})
            return
        registry.consume_token(token)
        self._json(200, {"consumed": True})

    def _handle_revoke(self, agent_id: str) -> None:
        count = registry.revoke_agent_tokens(agent_id)
        self._json(200, {"revoked_tokens": count})

    def _handle_deregister(self, agent_id: str) -> None:
        ok = registry.deregister_agent(agent_id)
        if ok:
            self._json(200, {"deregistered": True})
        else:
            self._json(404, {"error": "agent not found"})

    def _handle_agent_tokens(self, agent_id: str) -> None:
        tokens = registry.get_active_tokens(agent_id)
        self._json(200, {"tokens": [
            {
                "token": t.token[:12] + "...",
                "service": t.service,
                "action": t.action,
                "scope": t.scope,
                "expires_at": t.expires_at,
            }
            for t in tokens
        ]})

    def _handle_activity(self) -> None:
        qs = parse_qs(urlparse(self.path).query)
        agent_id = qs.get("agent_id", [None])[0]
        limit = int(qs.get("limit", [50])[0])
        activity = registry.get_activity(agent_id=agent_id, limit=limit)
        self._json(200, {"activity": activity})

    # ------------------------------------------------------------------ helpers

    def _read_body(self) -> dict | None:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    def _json(self, status: int, data: Any) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)


def _default_ttl(scope: str) -> int:
    return {"one_shot": 0, "time_window": 900, "task": 14400}.get(scope, 0)


def run(host: str = "0.0.0.0", port: int = DEFAULT_PORT) -> None:
    registry.init_db()
    server = ThreadingHTTPServer((host, port), AAuthHandler)
    print(f"A-Auth daemon running on {host}:{port}")
    print(f"Registry: {registry.DB_PATH}")
    print("Ctrl-C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDaemon stopped.")
