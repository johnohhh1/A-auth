/**
 * Home screen.
 *
 * Shows pairing status, pending requests (polled on focus),
 * and recent activity.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

import {
  checkHealth, getPendingRequests, getActivity,
  PendingRequest, ActivityEntry,
} from '../hooks/useDaemon';
import { useNotifications } from '../hooks/useNotifications';

export default function HomeScreen() {
  const [paired, setPaired] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { expoPushToken } = useNotifications();

  const load = useCallback(async () => {
    const daemonUrl = await SecureStore.getItemAsync('aauth_daemon_url');
    if (!daemonUrl) {
      setPaired(false);
      return;
    }
    const healthy = await checkHealth();
    setPaired(healthy);
    if (healthy) {
      const [p, a] = await Promise.all([getPendingRequests(), getActivity()]);
      setPending(p);
      setActivity(a);
    }
  }, []);

  // Reload whenever screen comes into focus (catches missed notifications)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (paired === false) {
    return (
      <View style={styles.center}>
        <Text style={styles.emoji}>🔐</Text>
        <Text style={styles.heading}>A-Auth</Text>
        <Text style={styles.sub}>Zero-trust approval for AI agents</Text>
        <TouchableOpacity style={styles.btn} onPress={() => router.push('/pair')}>
          <Text style={styles.btnText}>Pair with daemon →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (paired === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>Connecting…</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
      ListHeaderComponent={
        <View>
          {/* Pending approvals */}
          {pending.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>WAITING FOR YOU</Text>
              {pending.map((req) => (
                <TouchableOpacity
                  key={req.request_id}
                  style={styles.pendingCard}
                  onPress={() => router.push(`/approval/${req.request_id}`)}
                >
                  <View style={styles.pendingRow}>
                    <Text style={styles.agentName}>{req.agent_name}</Text>
                    <Text style={styles.expires}>{req.expires_in}s</Text>
                  </View>
                  <Text style={styles.serviceAction}>
                    {req.service} · {req.action}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Activity header */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>RECENT ACTIVITY</Text>
          </View>
        </View>
      }
      data={activity}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <View style={styles.activityRow}>
          <View style={styles.activityLeft}>
            <Text style={styles.activityAgent}>{item.agent_id}</Text>
            <Text style={styles.activityDetail}>
              {item.service} · {item.action}
            </Text>
          </View>
          <View style={[
            styles.badge,
            item.outcome === 'approved' ? styles.badgeApproved : styles.badgeDenied,
          ]}>
            <Text style={styles.badgeText}>{item.outcome}</Text>
          </View>
        </View>
      )}
      ListEmptyComponent={
        <Text style={styles.empty}>No activity yet</Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0a0a0a', padding: 32,
  },
  list: { flex: 1, backgroundColor: '#0a0a0a' },
  emoji: { fontSize: 56, marginBottom: 16 },
  heading: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 8 },
  sub: { color: '#888', fontSize: 15, textAlign: 'center', marginBottom: 32 },
  btn: {
    backgroundColor: '#0ea5e9', borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 28,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  section: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 4 },
  sectionTitle: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  pendingCard: {
    marginHorizontal: 16, marginTop: 10,
    backgroundColor: '#1a1a1a', borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: '#0ea5e9',
  },
  pendingRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  agentName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  expires: { color: '#0ea5e9', fontSize: 13, fontWeight: '600' },
  serviceAction: { color: '#aaa', fontSize: 14 },
  activityRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1a1a1a',
  },
  activityLeft: { flex: 1 },
  activityAgent: { color: '#fff', fontSize: 14, fontWeight: '600' },
  activityDetail: { color: '#666', fontSize: 13, marginTop: 1 },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  badgeApproved: { backgroundColor: '#14532d' },
  badgeDenied: { backgroundColor: '#3f1515' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  empty: { color: '#555', textAlign: 'center', marginTop: 48, fontSize: 14 },
});
