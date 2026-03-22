"""Desktop notification approval gate."""

import select
import subprocess
import sys
import time
from typing import Optional


TIMEOUT_SECONDS = 60


def _send_notification(title: str, body: str) -> None:
    """Send a desktop notification (Linux/macOS)."""
    if sys.platform == "darwin":
        script = f'display notification "{body}" with title "{title}"'
        subprocess.run(["osascript", "-e", script], capture_output=True)
    else:
        # Linux — try notify-send
        try:
            subprocess.run(
                ["notify-send", "--urgency=critical", "--expire-time=60000",
                 title, body],
                capture_output=True,
                timeout=5,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass  # notification not available — TTY prompt is the fallback


def prompt_approval(
    agent_id: str,
    agent_name: str,
    service: str,
    action: str,
    scope: str,
    ttl_seconds: int,
    timeout: int = TIMEOUT_SECONDS,
) -> tuple[bool, Optional[str]]:
    """
    Prompt the user for approval via desktop notification + TTY input.

    Returns (approved, scope_override).
    scope_override: if user picks a different scope/ttl at prompt time.
    """
    ttl_label = _ttl_label(scope, ttl_seconds)
    title = f"A-Auth: {agent_name} requests access"
    body = (
        f"Service: {service}  Action: {action}  Scope: {ttl_label}\n"
        f"Agent ID: {agent_id}"
    )

    _send_notification(title, body)

    # TTY prompt (always shown — notification is supplementary)
    print(f"\n{'='*60}", flush=True)
    print(f"  A-Auth Approval Request", flush=True)
    print(f"{'='*60}", flush=True)
    print(f"  Agent:   {agent_name} ({agent_id})", flush=True)
    print(f"  Service: {service}", flush=True)
    print(f"  Action:  {action}", flush=True)
    print(f"  Scope:   {ttl_label}", flush=True)
    print(f"{'='*60}", flush=True)
    print(f"  [y] Approve  [n] Deny  [1] One-shot  [15] 15-min  [60] 60-min", flush=True)
    print(f"  Timeout: {timeout}s", flush=True)
    print(f"  > ", end="", flush=True)

    answer = _timed_input(timeout)  # blocks until input or timeout
    if answer is None:
        print("(timed out — denied)", flush=True)
        return False, None

    answer = answer.strip().lower()

    if answer in ("n", "no", "deny", ""):
        return False, None

    if answer in ("y", "yes", "approve"):
        return True, None

    # Numeric shortcut — override TTL
    try:
        minutes = int(answer)
        override_scope = "time_window"
        override_ttl = minutes * 60
        return True, f"{override_scope}:{override_ttl}"
    except ValueError:
        return False, None


def _timed_input(timeout: int) -> Optional[str]:
    """Read a line from stdin with a timeout. Returns None on timeout.

    Uses select.select to avoid spawning a thread that outlives the timeout
    and races with the next prompt's stdin reader.
    """
    ready, _, _ = select.select([sys.stdin], [], [], timeout)
    if ready:
        try:
            return sys.stdin.readline().strip()
        except EOFError:
            return ""
    print()  # newline after timeout
    return None


def _ttl_label(scope: str, ttl_seconds: int) -> str:
    if scope == "one_shot":
        return "one-shot (single use)"
    if ttl_seconds <= 0:
        return "standing"
    minutes = ttl_seconds // 60
    if minutes < 60:
        return f"{minutes}min window"
    hours = minutes // 60
    return f"{hours}hr window"
