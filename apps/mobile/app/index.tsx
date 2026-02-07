import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Palette } from 'lucide-react-native';
import { BudiLogo, Button } from '@/components/ui';
import { colors, typography, spacing } from '@/theme';

export default function Home() {
  const router = useRouter();

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

      {/* TODO: Remove - temporary Design System QA link */}
      <View style={styles.dsLink}>
        <Button
          title="Ver Design System"
          icon={<Palette size={16} color={colors.primary[500]} strokeWidth={2} />}
          onPress={() => router.push('/design-system')}
          variant="tertiary"
          size="small"
        />
      </View>
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
