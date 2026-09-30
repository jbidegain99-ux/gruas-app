import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { supabase, signOut } from '@/lib/supabase';
import { Button, Input } from '@/shared/components/ui';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * "Eliminar mi cuenta" (migr. 00101 + Edge Function delete-account).
 *
 * Apple (guía 5.1.1(v)) y Google Play exigen que una app con registro deje
 * borrar la cuenta desde la propia app. Como no tiene vuelta atrás, se pide
 * escribir ELIMINAR: un toque accidental no puede borrar a nadie.
 *
 * Qué pasa de verdad se explica ANTES de confirmar: se borran los datos
 * personales y los archivos, pero los servicios quedan registrados sin nombre
 * (son registros contables). Decirlo evita prometer un "se borra todo" que no
 * es cierto.
 */
const PALABRA = 'ELIMINAR';

export function DeleteAccountRow() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (deleting) return;
    setVisible(false);
    setTyped('');
    setError(null);
  };

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke('delete-account', { method: 'POST' });

    // Las guardas (servicio en curso, cuenta de gestión) vuelven como 409 con el
    // motivo escrito para la persona: se muestra tal cual.
    if (fnError || !(data as { success?: boolean } | null)?.success) {
      let message = 'No se pudo eliminar la cuenta. Revisa tu conexión e intenta de nuevo.';
      const ctx = (fnError as { context?: Response } | null)?.context;
      if (ctx && typeof ctx.json === 'function') {
        try {
          const body = await ctx.json();
          if (body?.error) message = body.error;
        } catch {
          // cuerpo no JSON: queda el mensaje genérico
        }
      } else if ((data as { error?: string } | null)?.error) {
        message = (data as { error: string }).error;
      }
      setError(message);
      setDeleting(false);
      return;
    }

    // El servidor ya borró la sesión: `scope: 'local'` solo limpia la guardada
    // acá. Un signOut normal le pide al servidor cerrarla y responde 500.
    await signOut({ scope: 'local' });
    setDeleting(false);
    setVisible(false);
    router.replace('/(auth)/login');
  };

  return (
    <>
      <Pressable
        style={styles.row}
        onPress={() => setVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Eliminar mi cuenta"
      >
        <Trash2 size={18} color={colors.error.main} />
        <Text style={styles.rowText}>Eliminar mi cuenta</Text>
      </Pressable>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Eliminar tu cuenta</Text>
            <Text style={styles.body}>Esto no se puede deshacer. Al eliminarla:</Text>
            <View style={styles.list}>
              <Text style={styles.item}>• Se borran tu nombre, teléfono, correo, DUI, vehículos y fotos.</Text>
              <Text style={styles.item}>• No vas a poder volver a entrar con esta cuenta.</Text>
              <Text style={styles.item}>
                • Los servicios que ya se hicieron quedan registrados sin tus datos, porque son registros contables.
              </Text>
            </View>
            <Text style={styles.body}>
              Para confirmar, escribe <Text style={styles.word}>{PALABRA}</Text>.
            </Text>
            <Input
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={PALABRA}
              accessibilityLabel={`Escribe ${PALABRA} para confirmar`}
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <View style={styles.buttons}>
              <View style={styles.flex}>
                <Button title="Cancelar" onPress={close} variant="secondary" size="medium" disabled={deleting} />
              </View>
              <View style={styles.flex}>
                <Pressable
                  onPress={confirm}
                  disabled={typed.trim().toUpperCase() !== PALABRA || deleting}
                  style={[styles.danger, (typed.trim().toUpperCase() !== PALABRA || deleting) && styles.dangerDisabled]}
                  accessibilityRole="button"
                >
                  <Text style={styles.dangerText}>{deleting ? 'Eliminando…' : 'Eliminar'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingVertical: spacing.s,
  },
  rowText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.body,
    color: colors.error.main,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: spacing.l,
  },
  sheet: {
    backgroundColor: colors.background.primary,
    borderRadius: radii.l,
    padding: spacing.l,
    gap: spacing.s,
  },
  title: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
  },
  body: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
  },
  list: { gap: spacing.micro },
  item: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
    lineHeight: 20,
  },
  word: { fontFamily: typography.fonts.bodySemiBold, color: colors.error.main },
  error: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.error.main,
  },
  buttons: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.s },
  flex: { flex: 1 },
  danger: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.m,
    backgroundColor: colors.error.main,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerDisabled: { opacity: 0.4 },
  dangerText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.white,
  },
});
