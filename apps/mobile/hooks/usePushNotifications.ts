import { useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';
import { router } from 'expo-router';

// Configure notification handling
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

interface PushNotificationState {
  expoPushToken: string | null;
  notification: Notifications.Notification | null;
  error: string | null;
}

interface UsePushNotificationsResult extends PushNotificationState {
  registerForPushNotifications: () => Promise<string | null>;
  unregisterPushToken: () => Promise<void>;
}

/**
 * Hook to manage push notifications with Expo
 * Handles permission requests, token registration, and notification handling
 */
export function usePushNotifications(): UsePushNotificationsResult {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notifications.Notification | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  // Register for push notifications
  const registerForPushNotifications = useCallback(async (): Promise<string | null> => {
    try {
      // Must be a physical device
      if (!Device.isDevice) {
        console.log('Push notifications require a physical device');
        setError('Las notificaciones requieren un dispositivo físico');
        return null;
      }

      // Check existing permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      // Request permission if not granted
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('Push notification permission denied');
        setError('Permiso de notificaciones denegado');
        return null;
      }

      // Get the Expo push token
      const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

      if (!projectId) {
        console.error('No project ID found for push notifications');
        setError('Error de configuración de notificaciones');
        return null;
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId,
      });

      const token = tokenData.data;
      setExpoPushToken(token);

      // Register token with Supabase
      const deviceType = Platform.OS as 'ios' | 'android';
      const { error: registerError } = await supabase.rpc('register_device_token', {
        p_expo_push_token: token,
        p_device_type: deviceType,
      });

      if (registerError) {
        console.error('Error registering device token:', registerError);
        // Don't set error state - token still works locally
      } else {
        console.log('Device token registered successfully');
      }

      // Android-specific notification channel
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF7B00',
        });

        // Service updates channel
        await Notifications.setNotificationChannelAsync('service_updates', {
          name: 'Actualizaciones de Servicio',
          description: 'Notificaciones sobre el estado de tu servicio de grúa',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF7B00',
        });
      }

      setError(null);
      return token;
    } catch (err) {
      console.error('Error registering for push notifications:', err);
      setError('Error al registrar notificaciones');
      return null;
    }
  }, []);

  // Unregister push token
  const unregisterPushToken = useCallback(async () => {
    if (!expoPushToken) return;

    try {
      const { error: unregisterError } = await supabase.rpc('unregister_device_token', {
        p_expo_push_token: expoPushToken,
      });

      if (unregisterError) {
        console.error('Error unregistering device token:', unregisterError);
      } else {
        console.log('Device token unregistered');
        setExpoPushToken(null);
      }
    } catch (err) {
      console.error('Exception unregistering device token:', err);
    }
  }, [expoPushToken]);

  // Handle notification navigation
  const handleNotificationResponse = useCallback((response: Notifications.NotificationResponse) => {
    const data = response.notification.request.content.data;

    // Navigate based on notification type
    if (data?.type === 'service_assigned') {
      // User: operator was assigned to their request
      router.push('/(user)');
    } else if (data?.type === 'service_status_update') {
      // User: service status changed
      router.push('/(user)');
    } else if (data?.type === 'new_service_request') {
      // Operator: new service request assigned
      router.push('/(operator)/active');
    } else if (data?.type === 'service_cancelled') {
      // Service was cancelled
      if (data?.role === 'operator') {
        router.push('/(operator)');
      } else {
        router.push('/(user)');
      }
    }
  }, []);

  // Set up notification listeners
  useEffect(() => {
    // Listener for notifications received while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (receivedNotification: Notifications.Notification) => {
        console.log('Notification received:', receivedNotification);
        setNotification(receivedNotification);
      }
    );

    // Listener for when user taps on notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response: Notifications.NotificationResponse) => {
        console.log('Notification response:', response);
        handleNotificationResponse(response);
      }
    );

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [handleNotificationResponse]);

  return {
    expoPushToken,
    notification,
    error,
    registerForPushNotifications,
    unregisterPushToken,
  };
}

// Utility function to send local notification (for testing)
export async function sendLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: true,
    },
    trigger: null, // Immediately
  });
}
