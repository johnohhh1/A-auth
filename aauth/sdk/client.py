"""A-Auth Python SDK — for use by AI agents."""

import json
import time
import warnings
import urllib.request
import urllib.error
from contextlib import contextmanager
from typing import Optional, Generator

from aauth.daemon.server import DEFAULT_PORT


class AAuthError(Exception):
    pass


class TokenDeniedError(AAuthError):
    pass


class AgentNotRegisteredError(AAuthError):
    pass


class AAuth:
    """
    A-Auth client. Agents use this to request permission tokens.

    Basic usage:
        aa = AAuth(agent_id="my-agent")

        # One-shot: approve for a single call
        token = aa.request("gmail", "read")

        # Time-windowed: approve for 15 minutes
        with aa.window("gmail", "read", ttl_minutes=15) as session:
            token = session.token

        # Task-scoped: approve until task.done()
        with aa.task("daily-digest") as task:
            token = task.request("gmail", "read")
            ...
            # token revoked automatically on exit
    """

    def __init__(
        self,
        agent_id: str,
        host: str = "127.0.0.1",
        port: int = DEFAULT_PORT,
    ):
        self.agent_id = agent_id
        self.base_url = f"http://{host}:{port}"

    # ------------------------------------------------------------------ core

    def request(
        self,
        service: str,
        action: str,
        scope: str = "one_shot",
        ttl_seconds: int = 0,
    ) -> str:
        """
        Request a permission token. Blocks until the user approves or denies.
        Returns the token string on approval. Raises TokenDeniedError on denial.
        """
        result = self._post("/request", {
            "agent_id": self.agent_id,
            "service": service,
            "action": action,
            "scope": scope,
            "ttl_seconds": ttl_seconds,
        })

        if "error" in result:
            if "not registered" in result["error"]:
                raise AgentNotRegisteredError(
                    f"Agent '{self.agent_id}' is not registered. "
                    "Run: aauth register <agent_id> <name>"
                )
            raise TokenDeniedError(result["error"])

        return result["token"]

    def validate(self, token: str, service: str, action: str) -> bool:
        """Check if a token is still valid for a given service/action."""
        result = self._post("/validate", {
            "token": token,
            "service": service,
            "action": action,
        })
        return result.get("valid", False)

    def consume(self, token: str) -> None:
        """Mark a one-shot token as used."""
        self._post("/consume", {"token": token})

    # ------------------------------------------------------------------ context managers

    @contextmanager
    def window(
        self,
        service: str,
        action: str,
        ttl_minutes: int = 15,
    ) -> Generator["WindowSession", None, None]:
        """
        Context manager for time-windowed access.

            with aa.window("gmail", "read", ttl_minutes=15) as session:
                token = session.token
                # use token for up to 15 minutes
        """
        token = self.request(service, action, scope="time_window",
                             ttl_seconds=ttl_minutes * 60)
        session = WindowSession(token=token, service=service, action=action,
                                client=self)
        try:
            yield session
        finally:
            pass  # time-windowed tokens expire naturally; no explicit revoke needed

    @contextmanager
    def task(self, task_name: str) -> Generator["TaskSession", None, None]:
        """
        Context manager for task-scoped access. Tokens live until the context exits.

            async with aa.task("daily-digest") as task:
                gmail_token = task.request("gmail", "read")
                sheets_token = task.request("sheets", "write")
            # both tokens revoked on exit
        """
        session = TaskSession(agent_id=self.agent_id, task_name=task_name,
                              client=self)
        try:
            yield session
        finally:
            session._revoke_all()

    # ------------------------------------------------------------------ HTTP

    def _post(self, path: str, data: dict) -> dict:
        body = json.dumps(data).encode()
        req = urllib.request.Request(
            self.base_url + path,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                try:
                    return json.loads(resp.read())
                except json.JSONDecodeError as e:
                    raise AAuthError(f"Daemon returned malformed JSON: {e}") from e
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read())
            except json.JSONDecodeError:
                raise AAuthError(
                    f"Daemon returned malformed error response (HTTP {e.code})"
                ) from e
        except urllib.error.URLError as e:
            raise AAuthError(
                f"Cannot connect to A-Auth daemon at {self.base_url}. "
                "Is it running? Start with: aauth daemon"
            ) from e


class WindowSession:
    """Holds a time-windowed token."""

    def __init__(self, token: str, service: str, action: str, client: AAuth):
        self.token = token
        self.service = service
        self.action = action
        self._client = client

    def is_valid(self) -> bool:
        return self._client.validate(self.token, self.service, self.action)


class TaskSession:
    """Task-scoped session — collects tokens and revokes them on exit."""

    def __init__(self, agent_id: str, task_name: str, client: AAuth):
        self.agent_id = agent_id
        self.task_name = task_name
        self._client = client
        self._tokens: list[str] = []

    def request(self, service: str, action: str) -> str:
        """Request a task-scoped token (4hr hard ceiling)."""
        token = self._client.request(service, action, scope="task",
                                     ttl_seconds=4 * 3600)
        self._tokens.append(token)
        return token

    def _revoke_all(self) -> None:
        errors = []
        for token in self._tokens:
            try:
                self._client.consume(token)
            except Exception as e:
                errors.append(e)
        if errors:
            msg = (
                f"A-Auth: {len(errors)} token(s) failed to revoke for agent "
                f"{self.agent_id!r}. Tokens may still be active. "
                f"First error: {errors[0]}"
            )
            warnings.warn(msg)
            raise errors[0]


class PermissionChain:
    """
    Request multiple permissions in a single user interaction.

    Usage:
        with aa.chain([("gmail", "read"), ("sheets", "write")]) as chain:
            gmail_token = chain.tokens["gmail:read"]
            sheets_token = chain.tokens["sheets:write"]
    """

    def __init__(self, agent_id: str, grants: list[tuple[str, str]], client: AAuth):
        self.agent_id = agent_id
        self.grants = grants
        self._client = client
        self.tokens: dict[str, str] = {}

    def __enter__(self):
        # Request each permission sequentially (each triggers an approval prompt)
        # In v0.2 this will bundle into a single notification
        for service, action in self.grants:
            token = self._client.request(service, action, scope="task",
                                         ttl_seconds=4 * 3600)
            self.tokens[f"{service}:{action}"] = token
        return self

    def __exit__(self, *args):
        errors = []
        for token in self.tokens.values():
            try:
                self._client.consume(token)
            except Exception as e:
                errors.append(e)
        if errors:
            msg = (
                f"A-Auth: {len(errors)} token(s) failed to consume in PermissionChain "
                f"for agent {self.agent_id!r}. Tokens may still be active. "
                f"First error: {errors[0]}"
            )
            warnings.warn(msg)
            raise errors[0]
