import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Palette } from 'lucide-react-native';
import type { UserRole } from '@gruas-app/shared';
import { BudiLogo, Button, LoadingSpinner } from '@/shared/components/ui';
import { supabase } from '@/lib/supabase';
import { rutaDeInicio } from '@/shared/hooks/useRoleGuard';
import { colors, typography, spacing } from '@/theme';

export default function Home() {
  const router = useRouter();
  // Con sesión guardada se entra directo a la app de su rol. Antes esta
  // pantalla no la miraba: cada vez que se abría la app había que volver a
  // iniciar sesión (un socio que no lo hacía dejaba de recibir servicios).
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (userId) {
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single();
        const destino = rutaDeInicio((profile as { role: UserRole } | null)?.role);
        if (alive && destino) {
          router.replace(destino);
          return;
        }
      }
      if (alive) setChecking(false);
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  if (checking) {
    return (
      <View style={styles.container}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <BudiLogo variant="full" height={56} />
        <Text style={styles.subtitle}>Asistencia vial en El Salvador</Text>
      </View>

      <View style={styles.buttonContainer}>
        <Button
          title="Iniciar Sesión"
          onPress={() => router.push('/(auth)/login')}
        />
        <Button
          title="Registrarse"
          onPress={() => router.push('/(auth)/register')}
          variant="secondary"
        />
      </View>

      {/* Link de QA al Design System: solo en desarrollo, nunca en producción. */}
      {__DEV__ && (
        <View style={styles.dsLink}>
          <Button
            title="Ver Design System"
            icon={<Palette size={16} color={colors.primary[500]} strokeWidth={2} />}
            onPress={() => router.push('/design-system')}
            variant="tertiary"
            size="small"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.l,
    backgroundColor: colors.background.primary,
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.xxxxl,
  },
  subtitle: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    marginTop: spacing.s,
  },
  buttonContainer: {
    width: '100%',
    gap: spacing.m,
  },
  dsLink: {
    position: 'absolute',
    bottom: spacing.xxxl,
    alignSelf: 'center',
  },
});
