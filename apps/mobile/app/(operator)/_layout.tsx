import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { usePushNotifications } from '@/hooks/usePushNotifications';

export default function OperatorLayout() {
  const { registerForPushNotifications } = usePushNotifications();

  // Register for push notifications when operator is authenticated
  useEffect(() => {
    registerForPushNotifications();
  }, [registerForPushNotifications]);

  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Solicitudes',
          tabBarLabel: 'Solicitudes',
        }}
      />
      <Tabs.Screen
        name="active"
        options={{
          title: 'Servicio Activo',
          tabBarLabel: 'Activo',
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
