import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, ScrollView,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

import {
  checkHealth, getPendingRequests, getActivity,
  PendingRequest, ActivityEntry,
} from '../hooks/useDaemon';
import { useNotifications } from '../hooks/useNotifications';

// ── Unpaired: explain the product and guide to pairing ───────────────────────

function UnpairedScreen() {
  return (
    <ScrollView style={styles.bg} contentContainerStyle={styles.unpairedContent}>
      <Text style={styles.logo}>🔐</Text>
      <Text style={styles.logoTitle}>A-Auth</Text>
      <Text style={styles.logoSub}>Your phone is the vault.</Text>

      <View style={styles.explainerBox}>
        <Text style={styles.explainerHeading}>How it works</Text>
        <Step n="1" text="An AI agent on your computer requests access to a service (GitHub, AWS, Stripe…)" />
        <Step n="2" text="Your phone buzzes with a push notification" />
        <Step n="3" text="You review the request, authenticate with your fingerprint, and approve or deny" />
        <Step n="4" text="The agent gets a short-lived token — or gets blocked" />
      </View>

      <View style={styles.setupBox}>
        <Text style={styles.setupHeading}>Get started</Text>
        <Text style={styles.setupStep}>
          <Text style={styles.mono}>1.</Text>
          {'  '}On your computer, run:{'\n'}
          <Text style={styles.mono}>  pip install aauth{'\n'}  aauth daemon</Text>
        </Text>
        <Text style={styles.setupStep}>
          <Text style={styles.mono}>2.</Text>
          {'  '}Tap below and enter your machine's{'\n'}
          {'  '}Tailscale IP (e.g. 100.x.x.x)
        </Text>
      </View>

      <TouchableOpacity style={styles.pairBtn} onPress={() => router.push('/pair')}>
        <Text style={styles.pairBtnText}>Pair with your computer →</Text>
      </TouchableOpacity>

      <Text style={styles.footnote}>
        Credentials never leave your network.{'\n'}
        Approval goes directly over Tailscale — no cloud middleman.
      </Text>
    </ScrollView>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepBubble}><Text style={styles.stepN}>{n}</Text></View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

// ── Paired + empty: show what's coming ───────────────────────────────────────

function EmptyPairedScreen({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return (
    <ScrollView
      style={styles.bg}
      contentContainerStyle={styles.emptyContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#555" />}
    >
      <View style={styles.connectedBadge}>
        <View style={styles.dot} />
        <Text style={styles.connectedText}>Daemon connected</Text>
      </View>

      <Text style={styles.waitingEmoji}>👀</Text>
      <Text style={styles.waitingTitle}>Watching for agent requests</Text>
      <Text style={styles.waitingBody}>
        When an AI agent asks for access to a service, the request will appear
        here and you'll get a push notification.
      </Text>

      <View style={styles.testBox}>
        <Text style={styles.testHeading}>Test it now</Text>
        <Text style={styles.testCode}>{'from aauth.sdk.client import AAuth\naa = AAuth(agent_id="test-agent")\ntoken = aa.request("github", "read")\nprint("approved:", token)'}</Text>
        <Text style={styles.testHint}>Run this on your computer — your phone will buzz.</Text>
      </View>
    </ScrollView>
  );
}

// ── Main home screen ──────────────────────────────────────────────────────────

export default function HomeScreen() {
  const [paired, setPaired] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  useNotifications(); // register push token in background

  const load = useCallback(async () => {
    const daemonUrl = await SecureStore.getItemAsync('aauth_daemon_url');
    if (!daemonUrl) { setPaired(false); return; }
    const healthy = await checkHealth();
    setPaired(healthy);
    if (healthy) {
      const [p, a] = await Promise.all([getPendingRequests(), getActivity()]);
      setPending(p);
      setActivity(a);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (paired === null) {
    return <View style={[styles.bg, styles.center]}><Text style={styles.muted}>Connecting…</Text></View>;
  }

  if (paired === false) return <UnpairedScreen />;

  if (pending.length === 0 && activity.length === 0) {
    return <EmptyPairedScreen onRefresh={onRefresh} refreshing={refreshing} />;
  }

  return (
    <FlatList
      style={styles.bg}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#555" />}
      ListHeaderComponent={
        <View>
          <View style={[styles.connectedBadge, { marginHorizontal: 20, marginTop: 16 }]}>
            <View style={styles.dot} />
            <Text style={styles.connectedText}>Daemon connected</Text>
          </View>

          {pending.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>NEEDS YOUR APPROVAL</Text>
              <Text style={styles.sectionHint}>Tap a request to review and approve or deny</Text>
              {pending.map((req) => (
                <TouchableOpacity
                  key={req.request_id}
                  style={styles.pendingCard}
                  onPress={() => router.push(`/approval/${req.request_id}`)}
                >
                  <View style={styles.pendingTop}>
                    <Text style={styles.agentName}>{req.agent_name}</Text>
                    <View style={styles.expiryPill}>
                      <Text style={styles.expiryText}>⏱ {req.expires_in}s</Text>
                    </View>
                  </View>
                  <Text style={styles.serviceAction}>{req.service}  ·  {req.action}</Text>
                  <Text style={styles.tapHint}>Tap to review →</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>RECENT ACTIVITY</Text>
            <Text style={styles.sectionHint}>All approval decisions are logged here</Text>
          </View>
        </View>
      }
      data={activity}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <View style={styles.activityRow}>
          <View style={styles.activityLeft}>
            <Text style={styles.activityAgent}>{item.agent_id}</Text>
            <Text style={styles.activityDetail}>{item.service}  ·  {item.action}</Text>
          </View>
          <View style={[styles.badge, item.outcome === 'approved' ? styles.badgeApproved : styles.badgeDenied]}>
            <Text style={styles.badgeText}>{item.outcome === 'approved' ? '✓ approved' : '✕ denied'}</Text>
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#555', fontSize: 15 },

  // Unpaired
  unpairedContent: { padding: 28, paddingTop: 48, alignItems: 'center' },
  logo: { fontSize: 52, marginBottom: 12 },
  logoTitle: { color: '#fff', fontSize: 30, fontWeight: '800', marginBottom: 4 },
  logoSub: { color: '#555', fontSize: 16, marginBottom: 32 },

  explainerBox: {
    width: '100%', backgroundColor: '#111', borderRadius: 16,
    padding: 20, marginBottom: 20, borderWidth: 1, borderColor: '#1e1e1e',
  },
  explainerHeading: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 16 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  stepBubble: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#0ea5e9', alignItems: 'center', justifyContent: 'center',
    marginRight: 12, marginTop: 1,
  },
  stepN: { color: '#fff', fontSize: 13, fontWeight: '800' },
  stepText: { flex: 1, color: '#aaa', fontSize: 14, lineHeight: 20 },

  setupBox: {
    width: '100%', backgroundColor: '#111', borderRadius: 16,
    padding: 20, marginBottom: 28, borderWidth: 1, borderColor: '#1e1e1e',
  },
  setupHeading: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 14 },
  setupStep: { color: '#aaa', fontSize: 14, lineHeight: 22, marginBottom: 12 },
  mono: { fontFamily: 'monospace', color: '#0ea5e9', fontSize: 13 },

  pairBtn: {
    backgroundColor: '#0ea5e9', borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 32, marginBottom: 24, width: '100%', alignItems: 'center',
  },
  pairBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  footnote: { color: '#333', fontSize: 12, textAlign: 'center', lineHeight: 18 },

  // Empty paired
  emptyContent: { padding: 28, paddingTop: 32, alignItems: 'center' },
  connectedBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0d1f0d', borderRadius: 20,
    paddingVertical: 6, paddingHorizontal: 12, alignSelf: 'flex-start', marginBottom: 36,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ade80', marginRight: 7 },
  connectedText: { color: '#4ade80', fontSize: 13, fontWeight: '600' },
  waitingEmoji: { fontSize: 48, marginBottom: 16 },
  waitingTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  waitingBody: { color: '#666', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 32 },

  testBox: {
    width: '100%', backgroundColor: '#111', borderRadius: 16,
    padding: 20, borderWidth: 1, borderColor: '#1e1e1e',
  },
  testHeading: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 12 },
  testCode: {
    fontFamily: 'monospace', color: '#0ea5e9', fontSize: 12,
    lineHeight: 19, marginBottom: 10,
  },
  testHint: { color: '#555', fontSize: 13 },

  // Active home
  section: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 4 },
  sectionTitle: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  sectionHint: { color: '#333', fontSize: 12, marginTop: 3 },

  pendingCard: {
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: '#0d1b2a', borderRadius: 16,
    padding: 18, borderWidth: 1, borderColor: '#0ea5e9',
  },
  pendingTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  agentName: { color: '#fff', fontSize: 18, fontWeight: '800' },
  expiryPill: { backgroundColor: '#0c2233', borderRadius: 10, paddingVertical: 3, paddingHorizontal: 10 },
  expiryText: { color: '#0ea5e9', fontSize: 12, fontWeight: '600' },
  serviceAction: { color: '#aaa', fontSize: 14, marginBottom: 10 },
  tapHint: { color: '#0ea5e9', fontSize: 13, fontWeight: '600' },

  activityRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#151515',
  },
  activityLeft: { flex: 1 },
  activityAgent: { color: '#fff', fontSize: 14, fontWeight: '600' },
  activityDetail: { color: '#555', fontSize: 13, marginTop: 2 },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  badgeApproved: { backgroundColor: '#0d2e1a' },
  badgeDenied: { backgroundColor: '#2a0d0d' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
