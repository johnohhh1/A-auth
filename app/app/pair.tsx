/**
 * Pairing screen.
 *
 * User enters the daemon's Tailscale IP. App verifies /health,
 * registers the Expo push token with the daemon, and navigates home.
 */

import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, Alert,
} from 'react-native';
import { router } from 'expo-router';
import * as Device from 'expo-device';

import { saveDaemonUrl, registerPhone, checkHealth } from '../hooks/useDaemon';
import { useNotifications } from '../hooks/useNotifications';

export default function PairScreen() {
  const [ip, setIp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { expoPushToken, permissionGranted } = useNotifications();

  const handlePair = async () => {
    setError(null);
    const raw = ip.trim();
    if (!raw) { setError('Enter the daemon IP address'); return; }

    // Accept bare IP or full URL
    const url = raw.startsWith('http') ? raw : `http://${raw}:7437`;

    setLoading(true);
    try {
      await saveDaemonUrl(url);

      const healthy = await checkHealth();
      if (!healthy) {
        setError(`Can't reach daemon at ${url}\nIs it running? Is Tailscale connected?`);
        setLoading(false);
        return;
      }

      if (!expoPushToken) {
        if (!permissionGranted) {
          Alert.alert(
            'Notifications disabled',
            'A-Auth needs notification permission to alert you when an agent requests access. Enable it in Settings, then pair again.',
            [{ text: 'OK' }]
          );
        }
        // Pair anyway — phone will poll for pending requests on focus
        router.replace('/');
        return;
      }

      const deviceName = Device.deviceName ?? Device.modelName ?? 'iPhone';
      await registerPhone(expoPushToken, deviceName);

      router.replace('/');
    } catch (e: any) {
      setError(e?.message ?? 'Pairing failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.heading}>Pair with your daemon</Text>
        <Text style={styles.sub}>
          Enter the Tailscale IP of the machine running{'\n'}
          <Text style={styles.code}>aauth daemon</Text>
        </Text>

        <Text style={styles.label}>Tailscale IP</Text>
        <TextInput
          style={styles.input}
          placeholder="100.x.x.x"
          placeholderTextColor="#444"
          value={ip}
          onChangeText={setIp}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={handlePair}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handlePair}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>Pair →</Text>
          }
        </TouchableOpacity>

        <Text style={styles.hint}>
          Your Tailscale IP is shown by{'\n'}
          <Text style={styles.code}>tailscale ip -4</Text>
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  inner: { flex: 1, padding: 32, justifyContent: 'center' },
  heading: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 8 },
  sub: { color: '#888', fontSize: 15, marginBottom: 32, lineHeight: 22 },
  label: { color: '#666', fontSize: 12, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 },
  input: {
    backgroundColor: '#1a1a1a', borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 16,
    color: '#fff', fontSize: 18, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 16, borderWidth: 1, borderColor: '#2a2a2a',
  },
  error: { color: '#f87171', fontSize: 14, marginBottom: 16, lineHeight: 20 },
  btn: {
    backgroundColor: '#0ea5e9', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginBottom: 24,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { color: '#444', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: '#666' },
});
