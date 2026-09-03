import { View, Text, StyleSheet } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { colors, typography, spacing, radii } from '@/theme';
import type { CopayPreview } from '../hooks/useCoveragePreview';

/**
 * B-13 — desglose de copago en el resumen, antes de confirmar.
 *
 * Solo se muestra cuando el usuario esta cubierto (el llamador lo condiciona).
 * Traduce lo que devuelve preview_my_coverage a tres lineas: lo que costaria,
 * lo que asume el seguro y —destacado— lo que le queda a la persona. Si el
 * copago es 0, se dice explicitamente que no paga nada.
 */
export function CopayBreakdown({
  preview,
  isEstimate,
}: {
  preview: CopayPreview;
  isEstimate?: boolean;
}) {
  const money = (n: number | null | undefined) => `$${(n ?? 0).toFixed(2)}`;
  const exceso = preview.excess_km_charge ?? 0;

  // El afiliado esta cubierto pero este servicio esta excluido del plan: no hay
  // desglose que mostrar, solo aclarar que lo paga entero.
  if (!preview.covered) {
    return (
      <View style={[styles.card, styles.cardNeutral]}>
        <View style={styles.head}>
          <ShieldCheck size={16} color={colors.text.secondary} strokeWidth={2} />
          <Text style={[styles.headText, { color: colors.text.primary }]}>
            Este servicio no lo cubre tu plan
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.copayLabel}>A pagar</Text>
          <Text style={styles.copayValue}>{money(preview.amount_copay)}</Text>
        </View>
        <Text style={styles.foot}>
          Tu seguro cubre otros servicios, pero no este. Lo pagás como particular.
        </Text>
      </View>
    );
  }

  const sinCosto = (preview.amount_copay ?? 0) <= 0;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <ShieldCheck size={16} color={colors.success.dark} strokeWidth={2} />
        <Text style={styles.headText}>Con tu seguro</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Precio estimado</Text>
        <Text style={styles.value}>{money(preview.amount_total)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Cubre tu seguro</Text>
        <Text style={[styles.value, styles.covered]}>-{money(preview.amount_covered)}</Text>
      </View>
      {exceso > 0 && (
        <Text style={styles.excessNote}>
          Incluye {money(exceso)} de kilómetros que tu plan no cubre.
        </Text>
      )}

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.copayLabel}>{sinCosto ? 'A pagar' : 'Tu copago'}</Text>
        <Text style={[styles.copayValue, sinCosto && styles.copayFree]}>
          {sinCosto ? 'Sin costo' : money(preview.amount_copay)}
        </Text>
      </View>

      {sinCosto ? (
        <Text style={styles.foot}>Tu seguro cubre todo este servicio.</Text>
      ) : (
        <Text style={styles.foot}>
          {isEstimate
            ? 'Aproximado. Se ajusta con la distancia real al cerrar el servicio.'
            : 'Lo pagás al finalizar el servicio.'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.success.light,
    borderColor: colors.success.main,
    borderWidth: 1,
    borderRadius: radii.m,
    padding: spacing.m,
    marginTop: spacing.m,
    gap: 6,
  },
  cardNeutral: { backgroundColor: colors.background.secondary, borderColor: colors.border.light },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 2 },
  headText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.success.dark,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontFamily: typography.fonts.body, fontSize: typography.sizes.bodySmall, color: colors.text.secondary },
  value: { fontFamily: typography.fonts.bodyMedium, fontSize: typography.sizes.bodySmall, color: colors.text.primary },
  covered: { color: colors.success.dark },
  excessNote: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
    lineHeight: 15,
  },
  divider: { height: 1, backgroundColor: colors.success.main, opacity: 0.4, marginVertical: 4 },
  copayLabel: { fontFamily: typography.fonts.bodyBold, fontSize: typography.sizes.body, color: colors.text.primary },
  copayValue: { fontFamily: typography.fonts.heading, fontSize: typography.sizes.h4, color: colors.text.primary },
  copayFree: { color: colors.success.dark },
  foot: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    lineHeight: 15,
  },
});
