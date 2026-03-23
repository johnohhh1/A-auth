import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';

import { getPendingRequests, respondToRequest, PendingRequest } from '../../hooks/useDaemon';

const SCOPE_INFO: Record<string, { label: string; description: string }> = {
  one_shot:    { label: 'One-shot',     description: 'Token expires immediately after the agent uses it once.' },
  time_window: { label: 'Time window',  description: 'Token is valid for a fixed time period.' },
  task:        { label: 'Task-scoped',  description: 'Token is valid until the agent\'s current task completes.' },
};

export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<'approve' | 'deny' | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    getPendingRequests().then((pending) => {
      const match = pending.find((r) => r.request_id === id);
      setRequest(match ?? null);
      if (match) setTimeLeft(match.expires_in);
      setLoading(false);
    });
  }, [id]);

  // Countdown timer
  useEffect(() => {
    if (!request || timeLeft <= 0) return;
    const t = setInterval(() => setTimeLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [request, timeLeft > 0]);

  const handleApprove = async () => {
    const biometricAvailable = await LocalAuthentication.hasHardwareAsync();
    if (biometricAvailable) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Approve ${request?.agent_name ?? 'agent'} → ${request?.service}`,
        fallbackLabel: 'Use passcode',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (!result.success) return;
    }
    setResponding('approve');
    try {
      await respondToRequest(id, true);
      router.replace('/');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not send approval');
      setResponding(null);
    }
  };

  const handleDeny = async () => {
    setResponding('deny');
    try {
      await respondToRequest(id, false);
      router.replace('/');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not send denial');
      setResponding(null);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#0ea5e9" size="large" /></View>;
  }

  if (!request) {
    return (
      <View style={styles.center}>
        <Text style={styles.expiredEmoji}>⌛</Text>
        <Text style={styles.expiredTitle}>Request expired</Text>
        <Text style={styles.expiredBody}>This request was already resolved or timed out.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/')}>
          <Text style={styles.backBtnText}>← Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const scope = SCOPE_INFO[request.scope] ?? { label: request.scope, description: '' };
  const urgent = timeLeft < 15;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerLabel}>ACCESS REQUEST</Text>
        <View style={[styles.timerPill, urgent && styles.timerPillUrgent]}>
          <Text style={[styles.timerText, urgent && styles.timerTextUrgent]}>
            ⏱ {timeLeft}s
          </Text>
        </View>
      </View>

      {/* Agent card */}
      <View style={styles.agentCard}>
        <Text style={styles.agentLabel}>AGENT REQUESTING ACCESS</Text>
        <Text style={styles.agentName}>{request.agent_name}</Text>
        <Text style={styles.agentId}>{request.agent_id}</Text>
      </View>

      {/* What they want */}
      <View style={styles.detailCard}>
        <Text style={styles.detailCardTitle}>What they're asking for</Text>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Service</Text>
          <Text style={styles.detailValue}>{request.service}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Action</Text>
          <Text style={styles.detailValue}>{request.action}</Text>
        </View>
        <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.detailLabel}>Token scope</Text>
          <Text style={styles.detailValue}>{scope.label}</Text>
        </View>
        {scope.description ? (
          <Text style={styles.scopeNote}>{scope.description}</Text>
        ) : null}
      </View>

      {/* What happens */}
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          {responding === null
            ? `Approving grants ${request.agent_name} a short-lived token for ${request.service}. Denying blocks the request immediately.`
            : responding === 'approve'
              ? '🔑 Sending approval…'
              : '🚫 Blocking request…'
          }
        </Text>
      </View>

      {/* Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.denyBtn, !!responding && styles.btnDisabled]}
          onPress={handleDeny}
          disabled={!!responding}
        >
          {responding === 'deny'
            ? <ActivityIndicator color="#f87171" />
            : <Text style={styles.denyText}>✕  Deny</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.approveBtn, !!responding && styles.btnDisabled]}
          onPress={handleApprove}
          disabled={!!responding}
        >
          {responding === 'approve'
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.approveText}>✓  Approve</Text>
          }
        </TouchableOpacity>
      </View>

      <Text style={styles.biometricNote}>
        Approving requires biometric confirmation (fingerprint or face).
      </Text>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0a0a0a', padding: 32,
  },

  expiredEmoji: { fontSize: 48, marginBottom: 16 },
  expiredTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  expiredBody: { color: '#555', fontSize: 15, textAlign: 'center', marginBottom: 24 },
  backBtn: { paddingVertical: 12, paddingHorizontal: 24 },
  backBtnText: { color: '#0ea5e9', fontSize: 16, fontWeight: '600' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  headerLabel: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  timerPill: {
    backgroundColor: '#1a2a3a', borderRadius: 12,
    paddingVertical: 4, paddingHorizontal: 12,
  },
  timerPillUrgent: { backgroundColor: '#2a1010' },
  timerText: { color: '#0ea5e9', fontSize: 13, fontWeight: '700' },
  timerTextUrgent: { color: '#f87171' },

  agentCard: {
    backgroundColor: '#111', borderRadius: 16,
    padding: 20, marginBottom: 12,
    borderWidth: 1, borderColor: '#1e1e1e',
  },
  agentLabel: { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8 },
  agentName: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 4 },
  agentId: { color: '#555', fontSize: 13, fontFamily: 'monospace' },

  detailCard: {
    backgroundColor: '#111', borderRadius: 16,
    padding: 20, marginBottom: 12,
    borderWidth: 1, borderColor: '#1e1e1e',
  },
  detailCardTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 16 },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e1e1e',
  },
  detailLabel: { color: '#666', fontSize: 15 },
  detailValue: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 16 },
  scopeNote: { color: '#555', fontSize: 12, lineHeight: 17, marginTop: 10 },

  infoBox: {
    backgroundColor: '#0d1b2a', borderRadius: 12,
    padding: 14, marginBottom: 24,
    borderWidth: 1, borderColor: '#0e2a3d',
  },
  infoText: { color: '#7ab8d4', fontSize: 13, lineHeight: 19 },

  actions: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  denyBtn: {
    flex: 1, borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', borderWidth: 1.5, borderColor: '#f87171',
  },
  approveBtn: {
    flex: 2, borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', backgroundColor: '#0ea5e9',
  },
  btnDisabled: { opacity: 0.5 },
  denyText: { color: '#f87171', fontSize: 17, fontWeight: '700' },
  approveText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  biometricNote: { color: '#333', fontSize: 12, textAlign: 'center' },
});
