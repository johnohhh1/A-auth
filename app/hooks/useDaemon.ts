/**
 * A-Auth daemon API client.
 *
 * Talks to the daemon over Tailscale. The daemon address is stored in
 * SecureStore after pairing. All approval callbacks go directly over
 * Tailscale — no credentials touch Expo servers.
 */

import * as SecureStore from 'expo-secure-store';

const DAEMON_KEY = 'aauth_daemon_url';
const DEVICE_KEY = 'aauth_device_name';

export interface PendingRequest {
  request_id: string;
  agent_id: string;
  agent_name: string;
  service: string;
  action: string;
  scope: string;
  created_at: number;
  expires_in: number;
}

export interface ActivityEntry {
  id: number;
  agent_id: string;
  service: string;
  action: string;
  outcome: string;
  ts: number;
}

async function getDaemonUrl(): Promise<string | null> {
  return SecureStore.getItemAsync(DAEMON_KEY);
}

async function fetchDaemon(
  path: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data: any }> {
  const base = await getDaemonUrl();
  if (!base) throw new Error('No daemon URL — pair first');

  const resp = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await resp.json();
  return { ok: resp.ok, status: resp.status, data };
}

/** Store daemon address after pairing. */
export async function saveDaemonUrl(url: string): Promise<void> {
  // Normalise: strip trailing slash, ensure http://
  const clean = url.replace(/\/$/, '');
  await SecureStore.setItemAsync(DAEMON_KEY, clean);
}

export async function clearDaemonUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(DAEMON_KEY);
}

export async function getStoredDaemonUrl(): Promise<string | null> {
  return getDaemonUrl();
}

/** Check daemon health. Returns true if reachable. */
export async function checkHealth(): Promise<boolean> {
  try {
    const { data } = await fetchDaemon('/health');
    return data?.status === 'ok';
  } catch {
    return false;
  }
}

/** Register this device's Expo push token with the daemon. */
export async function registerPhone(
  expoPushToken: string,
  deviceName: string
): Promise<void> {
  const { ok, data } = await fetchDaemon('/phone/register', {
    method: 'POST',
    body: JSON.stringify({ expo_token: expoPushToken, device_name: deviceName }),
  });
  if (!ok) throw new Error(data?.error ?? 'Registration failed');
  await SecureStore.setItemAsync(DEVICE_KEY, deviceName);
}

/** Unregister this device from the daemon. */
export async function unregisterPhone(): Promise<void> {
  await fetchDaemon('/phone/unregister', { method: 'POST', body: '{}' });
  await SecureStore.deleteItemAsync(DEVICE_KEY);
}

/** Fetch all pending approval requests. Used on app open to catch missed pushes. */
export async function getPendingRequests(): Promise<PendingRequest[]> {
  const { data } = await fetchDaemon('/requests/pending');
  return data?.pending ?? [];
}

/** Approve or deny a pending request. */
export async function respondToRequest(
  requestId: string,
  approved: boolean
): Promise<void> {
  const { ok, data } = await fetchDaemon(`/requests/${requestId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ approved }),
  });
  if (!ok) throw new Error(data?.error ?? 'Response failed');
}

/** Fetch recent activity log. */
export async function getActivity(limit = 20): Promise<ActivityEntry[]> {
  const { data } = await fetchDaemon(`/activity?limit=${limit}`);
  return data?.activity ?? [];
}

/** Check whether a phone is currently paired. */
export async function getPhoneStatus(): Promise<{ paired: boolean; device_name?: string }> {
  const { data } = await fetchDaemon('/phone');
  return data;
}
