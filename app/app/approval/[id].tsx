/**
 * Approval screen.
 *
 * Reached via push notification tap or from the pending list.
 * Shows agent name, service, action, scope.
 * Approve button triggers biometric auth, then calls daemon over Tailscale.
 * Deny button calls daemon immediately.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';

import { getPendingRequests, respondToRequest, PendingRequest } from '../../hooks/useDaemon';

export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<'approve' | 'deny' | null>(null);

  useEffect(() => {
    getPendingRequests().then((pending) => {
      const match = pending.find((r) => r.request_id === id);
      setRequest(match ?? null);
      setLoading(false);
    });
  }, [id]);

  const handleApprove = async () => {
    // Biometric gate — Face ID / Touch ID before anything is sent
    const biometricAvailable = await LocalAuthentication.hasHardwareAsync();
    if (biometricAvailable) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Approve ${request?.agent_name ?? 'agent'} access to ${request?.service}`,
        fallbackLabel: 'Use passcode',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (!result.success) return; // user cancelled or failed
    }

    setResponding('approve');
    try {
      await respondToRequest(id, true);
      router.replace('/');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not send approval');
    } finally {
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
    } finally {
      setResponding(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#0ea5e9" />
      </View>
    );
  }

  if (!request) {
    return (
      <View style={styles.center}>
        <Text style={styles.gone}>Request already resolved or expired</Text>
        <TouchableOpacity onPress={() => router.replace('/')}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const scopeLabel = {
    one_shot: 'One-shot',
    time_window: 'Time window',
    task: 'Task-scoped',
  }[request.scope] ?? request.scope;

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        {/* Agent */}
        <Text style={styles.agentLabel}>AGENT</Text>
        <Text style={styles.agentName}>{request.agent_name}</Text>
        <Text style={styles.agentId}>{request.agent_id}</Text>

        <View style={styles.divider} />

        {/* Request details */}
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Service</Text>
          <Text style={styles.rowValue}>{request.service}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Action</Text>
          <Text style={styles.rowValue}>{request.action}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Scope</Text>
          <Text style={styles.rowValue}>{scopeLabel}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Expires in</Text>
          <Text style={[styles.rowValue, request.expires_in < 15 && styles.urgent]}>
            {request.expires_in}s
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.denyBtn, responding === 'deny' && styles.btnDisabled]}
          onPress={handleDeny}
          disabled={!!responding}
        >
          {responding === 'deny'
            ? <ActivityIndicator color="#f87171" />
            : <Text style={styles.denyText}>Deny</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.approveBtn, responding === 'approve' && styles.btnDisabled]}
          onPress={handleApprove}
          disabled={!!responding}
        >
          {responding === 'approve'
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.approveText}>Approve  </Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a', padding: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  card: {
    backgroundColor: '#141414', borderRadius: 18,
    padding: 24, borderWidth: 1, borderColor: '#222',
    marginBottom: 24,
  },
  agentLabel: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 6 },
  agentName: { color: '#fff', fontSize: 26, fontWeight: '800' },
  agentId: { color: '#666', fontSize: 14, marginTop: 2, marginBottom: 20 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#222', marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  rowLabel: { color: '#666', fontSize: 15 },
  rowValue: { color: '#fff', fontSize: 15, fontWeight: '600' },
  urgent: { color: '#f87171' },
  actions: { flexDirection: 'row', gap: 12, paddingBottom: 32 },
  denyBtn: {
    flex: 1, borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', borderWidth: 1, borderColor: '#f87171',
  },
  approveBtn: {
    flex: 2, borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', backgroundColor: '#0ea5e9',
  },
  btnDisabled: { opacity: 0.5 },
  denyText: { color: '#f87171', fontSize: 17, fontWeight: '700' },
  approveText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  gone: { color: '#555', fontSize: 16, marginBottom: 16 },
  back: { color: '#0ea5e9', fontSize: 16 },
});
