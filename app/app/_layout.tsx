import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0a0a0a' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#0a0a0a' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'A-Auth' }} />
        <Stack.Screen name="pair" options={{ title: 'Pair with daemon' }} />
        <Stack.Screen
          name="approval/[id]"
          options={{
            title: 'Approval Request',
            presentation: 'modal',
          }}
        />
      </Stack>
    </>
  );
}
