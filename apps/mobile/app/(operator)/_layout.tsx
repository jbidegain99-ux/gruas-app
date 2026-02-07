import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { List, Zap, Star, User } from 'lucide-react-native';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { colors, typography } from '@/theme';

export default function OperatorLayout() {
  const { registerForPushNotifications } = usePushNotifications();

  // Register for push notifications when operator is authenticated
  useEffect(() => {
    registerForPushNotifications();
  }, [registerForPushNotifications]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent[500],
        tabBarInactiveTintColor: colors.text.tertiary,
        tabBarStyle: {
          backgroundColor: colors.background.primary,
          borderTopColor: colors.border.light,
          height: 60,
          paddingBottom: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontFamily: typography.fonts.bodyMedium,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Solicitudes',
          tabBarLabel: 'Solicitudes',
          tabBarIcon: ({ color, size }) => (
            <List size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="active"
        options={{
          title: 'Servicio Activo',
          tabBarLabel: 'Activo',
          tabBarIcon: ({ color, size }) => (
            <Zap size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="ratings"
        options={{
          title: 'Mis Resenas',
          tabBarLabel: 'Resenas',
          tabBarIcon: ({ color, size }) => (
            <Star size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarLabel: 'Perfil',
          tabBarIcon: ({ color, size }) => (
            <User size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
    </Tabs>
  );
}
