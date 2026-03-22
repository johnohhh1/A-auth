"""SQLite-backed agent registry and token store."""

import sqlite3
import secrets
import time
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, asdict


DB_PATH = Path.home() / ".aauth" / "registry.db"


@dataclass
class Agent:
    agent_id: str
    name: str
    description: str
    registered_at: float
    last_seen: float


@dataclass
class Token:
    token: str
    agent_id: str
    service: str
    action: str
    scope: str          # one_shot | time_window | task
    ttl_seconds: int    # 0 = one_shot (expires after first use)
    created_at: float
    expires_at: float   # 0 = never (standing, not in v0.1)
    used: bool = False


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS agents (
                agent_id    TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT NOT NULL,
                registered_at REAL NOT NULL,
                last_seen   REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tokens (
                token       TEXT PRIMARY KEY,
                agent_id    TEXT NOT NULL,
                service     TEXT NOT NULL,
                action      TEXT NOT NULL,
                scope       TEXT NOT NULL,
                ttl_seconds INTEGER NOT NULL,
                created_at  REAL NOT NULL,
                expires_at  REAL NOT NULL,
                used        INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
            );

            CREATE TABLE IF NOT EXISTS activity (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id    TEXT NOT NULL,
                service     TEXT NOT NULL,
                action      TEXT NOT NULL,
                token       TEXT,
                outcome     TEXT NOT NULL,
                ts          REAL NOT NULL
            );
        """)


# --- Agents ---

def register_agent(agent_id: str, name: str, description: str) -> Agent:
    now = time.time()
    agent = Agent(agent_id=agent_id, name=name, description=description,
                  registered_at=now, last_seen=now)
    with _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO agents VALUES (?, ?, ?, ?, ?)",
            (agent.agent_id, agent.name, agent.description,
             agent.registered_at, agent.last_seen)
        )
    return agent


def get_agent(agent_id: str) -> Optional[Agent]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM agents WHERE agent_id = ?", (agent_id,)
        ).fetchone()
    if not row:
        return None
    return Agent(**dict(row))


def list_agents() -> list[Agent]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM agents ORDER BY last_seen DESC"
        ).fetchall()
    return [Agent(**dict(r)) for r in rows]


def touch_agent(agent_id: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE agents SET last_seen = ? WHERE agent_id = ?",
            (time.time(), agent_id)
        )


def deregister_agent(agent_id: str) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM agents WHERE agent_id = ?", (agent_id,)
        )
        conn.execute(
            "DELETE FROM tokens WHERE agent_id = ?", (agent_id,)
        )
    return cursor.rowcount > 0


# --- Tokens ---

def mint_token(agent_id: str, service: str, action: str,
               scope: str, ttl_seconds: int) -> Token:
    now = time.time()
    token_str = f"aauth_{secrets.token_urlsafe(32)}"
    expires_at = now + ttl_seconds if ttl_seconds > 0 else 0
    tok = Token(
        token=token_str,
        agent_id=agent_id,
        service=service,
        action=action,
        scope=scope,
        ttl_seconds=ttl_seconds,
        created_at=now,
        expires_at=expires_at,
    )
    with _connect() as conn:
        conn.execute(
            "INSERT INTO tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (tok.token, tok.agent_id, tok.service, tok.action,
             tok.scope, tok.ttl_seconds, tok.created_at, tok.expires_at, 0)
        )
    return tok


def validate_token(token: str, service: str, action: str) -> tuple[bool, str]:
    """Returns (valid, reason)."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM tokens WHERE token = ?", (token,)
        ).fetchone()
    if not row:
        return False, "token not found"
    tok = Token(**{**dict(row), "used": bool(row["used"])})
    if tok.used and tok.scope == "one_shot":
        return False, "one-shot token already used"
    if tok.expires_at > 0 and time.time() > tok.expires_at:
        return False, "token expired"
    if tok.service != service or tok.action != action:
        return False, f"token scoped to {tok.service}/{tok.action}, not {service}/{action}"
    return True, "ok"


def consume_token(token: str) -> None:
    """Mark one-shot token as used."""
    with _connect() as conn:
        conn.execute(
            "UPDATE tokens SET used = 1 WHERE token = ?", (token,)
        )


def revoke_agent_tokens(agent_id: str) -> int:
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM tokens WHERE agent_id = ?", (agent_id,)
        )
    return cursor.rowcount


def get_active_tokens(agent_id: str) -> list[Token]:
    now = time.time()
    with _connect() as conn:
        rows = conn.execute(
            """SELECT * FROM tokens
               WHERE agent_id = ?
                 AND used = 0
                 AND (expires_at = 0 OR expires_at > ?)
               ORDER BY created_at DESC""",
            (agent_id, now)
        ).fetchall()
    return [Token(**{**dict(r), "used": bool(r["used"])}) for r in rows]


# --- Activity log ---

def log_activity(agent_id: str, service: str, action: str,
                 token: Optional[str], outcome: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO activity (agent_id, service, action, token, outcome, ts) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (agent_id, service, action, token, outcome, time.time())
        )


def get_activity(agent_id: Optional[str] = None, limit: int = 50) -> list[dict]:
    with _connect() as conn:
        if agent_id:
            rows = conn.execute(
                "SELECT * FROM activity WHERE agent_id = ? ORDER BY ts DESC LIMIT ?",
                (agent_id, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM activity ORDER BY ts DESC LIMIT ?",
                (limit,)
            ).fetchall()
    return [dict(r) for r in rows]
