import { Tabs } from 'expo-router';

export default function OperatorLayout() {
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
