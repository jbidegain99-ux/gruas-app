import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Download, X } from 'lucide-react-native';
import { Button } from '@/shared/components/ui';
import { colors, radii, spacing, typography } from '@/theme';
import { useAppVersionCheck } from '@/features/updates/hooks/useAppVersionCheck';

/**
 * Política de versión mínima (APP-09). Con una versión por debajo de la
 * mínima, tapa la app con "Actualiza la app"; si solo hay una más nueva,
 * muestra un aviso que se puede cerrar. Va en el layout raíz, encima de todo.
 */
export function UpdateGate({ children }: { children: React.ReactNode }) {
  const check = useAppVersionCheck();
  const [dismissed, setDismissed] = useState(false);

  const openStore = () => {
    if (check?.storeUrl) Linking.openURL(check.storeUrl);
  };

  if (check?.status === 'update_required') {
    return (
      <SafeAreaView style={styles.required}>
        <Download size={56} color={colors.primary[500]} strokeWidth={1.5} />
        <Text style={styles.title}>Actualiza la app</Text>
        <Text style={styles.message}>
          Esta versión de Budi ya no es compatible. Descarga la última versión para seguir pidiendo o atendiendo
          servicios.
        </Text>
        {check.storeUrl ? (
          <View style={styles.button}>
            <Button title="Ir a la tienda" onPress={openStore} />
          </View>
        ) : (
          <Text style={styles.message}>Búscala como “Budi” en la tienda de tu teléfono.</Text>
        )}
      </SafeAreaView>
    );
  }

  return (
    <>
      {children}
      {check?.status === 'update_available' && !dismissed && (
        <SafeAreaView edges={['bottom']} style={styles.bannerWrap} pointerEvents="box-none">
          <View style={styles.banner}>
            <Pressable style={styles.bannerText} onPress={openStore} accessibilityRole="link">
              <Text style={styles.bannerTitle}>Hay una versión nueva de Budi</Text>
              {check.storeUrl && <Text style={styles.bannerLink}>Actualizar</Text>}
            </Pressable>
            <Pressable onPress={() => setDismissed(true)} accessibilityLabel="Cerrar aviso" hitSlop={12}>
              <X size={20} color={colors.text.secondary} />
            </Pressable>
          </View>
        </SafeAreaView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  required: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.m,
    backgroundColor: colors.background.primary,
  },
  title: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
    color: colors.text.primary,
    textAlign: 'center',
  },
  message: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: { marginTop: spacing.s, alignSelf: 'stretch' },
  bannerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    margin: spacing.m,
    padding: spacing.m,
    borderRadius: radii.l,
    backgroundColor: colors.background.primary,
    borderWidth: 1,
    borderColor: colors.primary[100],
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  bannerText: { flex: 1 },
  bannerTitle: { fontFamily: typography.fonts.body, fontSize: typography.sizes.bodySmall, color: colors.text.primary },
  bannerLink: { fontFamily: typography.fonts.heading, fontSize: typography.sizes.bodySmall, color: colors.primary[500], marginTop: 2 },
});
