/**
 * Push notification setup.
 *
 * Registers for push permissions, returns the Expo push token.
 * Wires up a foreground notification listener that routes to the
 * approval screen.
 */

import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { router } from 'expo-router';

// Show notification banners even when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function useNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const notificationListener = useRef<Notifications.EventSubscription>();
  const responseListener = useRef<Notifications.EventSubscription>();

  useEffect(() => {
    registerForPushNotifications().then((token) => {
      if (token) {
        setExpoPushToken(token);
        setPermissionGranted(true);
      }
    });

    // Foreground: notification arrives while app is open → navigate to approval
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        const { request_id } = notification.request.content.data ?? {};
        if (request_id) {
          router.push(`/approval/${request_id}`);
        }
      });

    // Background/killed: user taps notification → app opens → navigate to approval
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const { request_id } = response.notification.request.content.data ?? {};
        if (request_id) {
          router.push(`/approval/${request_id}`);
        }
      });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  return { expoPushToken, permissionGranted };
}

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    // Simulator — push notifications don't work
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('aauth-approvals', {
      name: 'A-Auth Approvals',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0ea5e9',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const token = (await Notifications.getExpoPushTokenAsync({
    projectId: 'a8cfea40-7c8d-4fe0-aa94-9fd376f439e8',
  })).data;
  return token;
}
