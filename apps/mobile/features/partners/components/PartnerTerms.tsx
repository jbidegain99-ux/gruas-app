import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { CheckSquare, Square } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/dates';
import { Button, toast } from '@/shared/components/ui';
import { rpcErrorMessage } from '@/lib/partnerApplication';
import { colors, typography, spacing, radii } from '@/theme';

// Contrato del socio (migr. 00126, AGT-04). Se lee y se acepta desde el
// registro; la base guarda fecha, versión, IP y navegador. Se puede aceptar
// aunque el registro esté en revisión o aprobado: una versión nueva hay que
// aceptarla igual para seguir recibiendo solicitudes.

type Terms = { id: string; version: string; title: string; body: string };

export function PartnerTerms({
  accepted,
  onAccepted,
}: {
  /** Versión y fecha de la aceptación vigente, si ya aceptó. */
  accepted: { version: string; accepted_at: string } | null;
  onAccepted: () => void;
}) {
  const [terms, setTerms] = useState<Terms | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc('current_terms', { p_kind: 'partner' }).then(({ data }) => setTerms(data as unknown as Terms | null));
  }, []);

  if (accepted) {
    return (
      <Text style={styles.text}>
        Aceptaste la versión {accepted.version} el{' '}
        {formatDateTime(accepted.accepted_at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.
      </Text>
    );
  }
  if (!terms) return <Text style={styles.text}>Cargando el contrato…</Text>;

  const accept = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('accept_terms', { p_terms_id: terms.id });
    setBusy(false);
    if (error) {
      toast.error(rpcErrorMessage(error, 'No se pudo registrar la aceptación.'));
      return;
    }
    toast.success('Contrato aceptado.');
    onAccepted();
  };

  return (
    <View style={{ gap: spacing.m }}>
      <Text style={styles.title}>
        {terms.title} · versión {terms.version}
      </Text>
      <ScrollView style={styles.body} nestedScrollEnabled>
        <Text style={styles.text}>{terms.body}</Text>
      </ScrollView>
      <Pressable
        style={styles.checkRow}
        onPress={() => setChecked((c) => !c)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
      >
        {checked ? (
          <CheckSquare size={22} color={colors.primary[500]} />
        ) : (
          <Square size={22} color={colors.border.dark} />
        )}
        <Text style={[styles.text, { flex: 1 }]}>
          Leí el contrato y lo acepto. Entiendo que presto servicios como socio independiente, no como empleado de Budi.
        </Text>
      </Pressable>
      <Button title="Aceptar contrato" onPress={accept} disabled={!checked || busy} loading={busy} size="medium" />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: typography.fonts.headingMedium, fontSize: typography.sizes.bodySmall, color: colors.text.primary },
  body: {
    maxHeight: 260,
    padding: spacing.m,
    borderRadius: radii.m,
    borderWidth: 1,
    borderColor: colors.border.light,
    backgroundColor: colors.background.secondary,
  },
  text: { fontFamily: typography.fonts.body, fontSize: typography.sizes.bodySmall, color: colors.text.primary, lineHeight: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.s },
});
