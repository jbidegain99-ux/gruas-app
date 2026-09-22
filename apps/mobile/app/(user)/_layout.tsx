import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Home, CirclePlus, Clock, User } from 'lucide-react-native';
import { usePushNotifications } from '@/features/notifications/hooks/usePushNotifications';
import { useRoleGuard } from '@/shared/hooks/useRoleGuard';
import { LoadingSpinner } from '@/shared/components/ui';
import { colors, typography } from '@/theme';

export default function UserLayout() {
  // Estas pantallas son del cliente. Sin esto, llegar por un deep link con una
  // sesion de operador dejaba ver la app equivocada.
  const estado = useRoleGuard('USER');
  const { registerForPushNotifications } = usePushNotifications();

  // El token se registra recien cuando el rol dio bien: no tiene sentido atar el
  // dispositivo a un rol que esta a punto de ser redirigido.
  useEffect(() => {
    if (estado === 'autorizado') registerForPushNotifications();
  }, [estado, registerForPushNotifications]);

  if (estado !== 'autorizado') return <LoadingSpinner fullScreen />;

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
          title: 'Inicio',
          tabBarLabel: 'Inicio',
          tabBarIcon: ({ color, size }) => (
            <Home size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="request"
        options={{
          title: 'Solicitar',
          tabBarLabel: 'Solicitar',
          tabBarIcon: ({ color, size }) => (
            <CirclePlus size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Historial',
          tabBarLabel: 'Historial',
          tabBarIcon: ({ color, size }) => (
            <Clock size={size} color={color} strokeWidth={2} />
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
      {/* Ruta accesible desde el perfil, oculta del tab bar */}
      <Tabs.Screen name="vehicles" options={{ href: null }} />
    </Tabs>
  );
}
