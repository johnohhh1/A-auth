import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import * as Device from 'expo-device';

import { saveDaemonUrl, registerPhone, checkHealth } from '../hooks/useDaemon';
import { useNotifications } from '../hooks/useNotifications';

export default function PairScreen() {
  const [ip, setIp] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'checking' | 'registering'>('idle');
  const [error, setError] = useState<string | null>(null);
  const { expoPushToken, permissionGranted } = useNotifications();

  const handlePair = async () => {
    setError(null);
    const raw = ip.trim();
    if (!raw) { setError('Enter your Tailscale IP address'); return; }

    const url = raw.startsWith('http') ? raw : `http://${raw}:7437`;

    setLoading(true);
    setStatus('checking');
    try {
      await saveDaemonUrl(url);
      const healthy = await checkHealth();
      if (!healthy) {
        setError(
          `Can't reach the daemon at ${url}\n\n` +
          `Check that:\n` +
          `• aauth daemon is running on your computer\n` +
          `• Tailscale is connected on both devices\n` +
          `• The IP is correct (run tailscale ip -4)`
        );
        setLoading(false);
        setStatus('idle');
        return;
      }

      if (expoPushToken) {
        setStatus('registering');
        const deviceName = Device.deviceName ?? Device.modelName ?? 'Android';
        await registerPhone(expoPushToken, deviceName);
      }

      router.replace('/');
    } catch (e: any) {
      setError(e?.message ?? 'Pairing failed. Try again.');
    } finally {
      setLoading(false);
      setStatus('idle');
    }
  };

  const statusLabel = {
    idle: 'Pair →',
    checking: 'Reaching daemon…',
    registering: 'Registering phone…',
  }[status];

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">

        <Text style={styles.heading}>Connect your phone</Text>
        <Text style={styles.sub}>
          This pairs your phone with the A-Auth daemon running on your computer.
          Once paired, agent access requests will buzz your phone for approval.
        </Text>

        {/* Step 1 */}
        <View style={styles.stepCard}>
          <Text style={styles.stepNum}>Step 1 — Start the daemon</Text>
          <Text style={styles.stepBody}>
            On your computer, run:
          </Text>
          <View style={styles.codeBlock}>
            <Text style={styles.code}>pip install aauth</Text>
            <Text style={styles.code}>aauth daemon</Text>
          </View>
          <Text style={styles.stepNote}>
            The daemon listens on port 7437 and waits for agent requests.
          </Text>
        </View>

        {/* Step 2 */}
        <View style={styles.stepCard}>
          <Text style={styles.stepNum}>Step 2 — Enter your Tailscale IP</Text>
          <Text style={styles.stepBody}>
            Find it by running <Text style={styles.inlineCode}>tailscale ip -4</Text> on your computer.
            It looks like <Text style={styles.inlineCode}>100.x.x.x</Text>
          </Text>
          <TextInput
            style={[styles.input, error ? styles.inputError : null]}
            placeholder="100.x.x.x"
            placeholderTextColor="#333"
            value={ip}
            onChangeText={(t) => { setIp(t); setError(null); }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={handlePair}
          />
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handlePair}
          disabled={loading}
        >
          {loading
            ? <><ActivityIndicator color="#fff" style={{ marginRight: 10 }} /><Text style={styles.btnText}>{statusLabel}</Text></>
            : <Text style={styles.btnText}>{statusLabel}</Text>
          }
        </TouchableOpacity>

        {!permissionGranted && (
          <View style={styles.notifWarning}>
            <Text style={styles.notifWarningText}>
              ⚠️  Notifications are disabled. You won't get push alerts for agent requests — enable them in Settings for the best experience.
            </Text>
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  inner: { padding: 24, paddingTop: 12, paddingBottom: 40 },

  heading: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 8 },
  sub: { color: '#666', fontSize: 15, lineHeight: 22, marginBottom: 24 },

  stepCard: {
    backgroundColor: '#111', borderRadius: 14,
    padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: '#1e1e1e',
  },
  stepNum: { color: '#0ea5e9', fontSize: 13, fontWeight: '700', marginBottom: 8, letterSpacing: 0.3 },
  stepBody: { color: '#aaa', fontSize: 14, lineHeight: 20, marginBottom: 10 },
  stepNote: { color: '#555', fontSize: 13, lineHeight: 18, marginTop: 8 },
  codeBlock: {
    backgroundColor: '#0a0a0a', borderRadius: 8,
    padding: 12, borderWidth: 1, borderColor: '#1a1a1a',
  },
  code: { fontFamily: 'monospace', color: '#0ea5e9', fontSize: 13, lineHeight: 22 },
  inlineCode: { fontFamily: 'monospace', color: '#0ea5e9', fontSize: 13 },

  input: {
    backgroundColor: '#0a0a0a', borderRadius: 10,
    paddingVertical: 14, paddingHorizontal: 14,
    color: '#fff', fontSize: 18, fontFamily: 'monospace',
    marginTop: 4, borderWidth: 1, borderColor: '#2a2a2a',
  },
  inputError: { borderColor: '#f87171' },

  errorBox: {
    marginTop: 12, backgroundColor: '#1a0808',
    borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#3f1515',
  },
  errorText: { color: '#f87171', fontSize: 13, lineHeight: 20 },

  btn: {
    backgroundColor: '#0ea5e9', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  notifWarning: {
    marginTop: 16, backgroundColor: '#1a1400',
    borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#3d3000',
  },
  notifWarningText: { color: '#facc15', fontSize: 13, lineHeight: 19 },
});
