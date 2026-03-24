"""Expo push notification sender."""

import json
import urllib.request
import urllib.error

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def send_push(
    expo_token: str,
    title: str,
    body: str,
    data: dict,
) -> bool:
    """
    Send a push notification via Expo's push service.

    Returns True if accepted by Expo, False on error.
    Expo relays to APNs/FCM — no credentials touch Expo servers.
    The approval callback goes directly over Tailscale.
    """
    payload = json.dumps({
        "to": expo_token,
        "title": title,
        "body": body,
        "data": data,
        "sound": "default",
        "priority": "high",
        "channelId": "aauth-approvals",
    }).encode()

    req = urllib.request.Request(
        EXPO_PUSH_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            # Expo returns {"data": {...}} for single push or {"data": [...]} for batch
            data = result.get("data", {})
            ticket = data[0] if isinstance(data, list) else data
            ok = ticket.get("status") == "ok"
            if not ok:
                print(f"\n⚠️  Push failed: {ticket}", flush=True)
            else:
                print(f"\n📬 Push sent to {expo_token[:20]}...", flush=True)
            return ok
    except Exception as e:
        print(f"\n❌ Push error: {e}", flush=True)
        return False
