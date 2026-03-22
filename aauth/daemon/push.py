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
            # Expo returns {"data": [{"status": "ok"} or {"status": "error", ...}]}
            ticket = result.get("data", [{}])[0]
            return ticket.get("status") == "ok"
    except Exception:
        return False
