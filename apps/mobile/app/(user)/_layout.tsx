import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { usePushNotifications } from '@/hooks/usePushNotifications';

export default function UserLayout() {
  const { registerForPushNotifications } = usePushNotifications();

  // Register for push notifications when user is authenticated
  useEffect(() => {
    registerForPushNotifications();
  }, [registerForPushNotifications]);

  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarLabel: 'Inicio',
        }}
      />
      <Tabs.Screen
        name="request"
        options={{
          title: 'Solicitar Grúa',
          tabBarLabel: 'Solicitar',
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Historial',
          tabBarLabel: 'Historial',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarLabel: 'Perfil',
        }}
      />
    </Tabs>
  );
}
