import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Share, Pressable } from 'react-native';
import { Receipt, Share2 } from 'lucide-react-native';
import { SERVICE_TYPE_CONFIGS, type ServiceType } from '@gruas-app/shared';
import { formatDateTime } from '@/lib/dates';
import { colors, typography, spacing, radii } from '@/theme';
import { fetchServicePayment, METHOD_LABEL, receiptText, type ServicePayment } from '../lib/payments';

const when = (d: string) => formatDateTime(d, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Comprobante de pago de un servicio (migr. 00133, LAN-07), para el historial
 * del Usuario y del socio. Muestra lo pagado y, si aplica, lo que cubrió el
 * seguro; nunca la comisión de Budi. No es factura (eso es LAN-09).
 */
export function PaymentReceipt({ requestId }: { requestId: string }) {
  const [p, setP] = useState<ServicePayment | null>(null);

  const load = useCallback(() => {
    fetchServicePayment(requestId).then(setP).catch(() => setP(null));
  }, [requestId]);
  useEffect(load, [load]);

  if (!p || p.status === 'not_yet' || p.status === 'not_required' || p.status === 'void') return null;
  const serviceName = SERVICE_TYPE_CONFIGS[p.service_type as ServiceType]?.name ?? 'Servicio';

  if (p.status === 'pending') {
    return (
      <View style={[styles.box, styles.pending]}>
        <Text style={styles.title}>Pago pendiente: ${p.amount_due?.toFixed(2)}</Text>
        <Text style={styles.meta}>En efectivo al socio operador. El comprobante aparece cuando lo confirme.</Text>
      </View>
    );
  }

  const share = () => {
    Share.share({ message: receiptText(p, serviceName, p.paid_at ? when(p.paid_at) : '') }).catch(() => {});
  };

  return (
    <View style={styles.box} accessibilityLabel={`Comprobante ${p.receipt_number}`}>
      <View style={styles.header}>
        <Receipt size={18} color={colors.success.dark} strokeWidth={2} />
        <Text style={styles.title}>Comprobante {p.receipt_number}</Text>
        <Pressable onPress={share} hitSlop={12} accessibilityRole="button" accessibilityLabel="Compartir comprobante" style={styles.share}>
          <Share2 size={18} color={colors.primary[500]} strokeWidth={2} />
        </Pressable>
      </View>
      {p.total_price != null && <Line label="Precio del servicio" value={p.total_price} />}
      {p.payer === 'insurer' && p.covered != null && <Line label="Cubrió tu seguro" value={p.covered} />}
      {p.amount_due != null && (
        <Line label={`Pagado${p.method ? ` · ${METHOD_LABEL[p.method]}` : ''}`} value={p.amount_due} strong />
      )}
      {p.paid_at && <Text style={styles.meta}>{when(p.paid_at)}</Text>}
      <Text style={styles.meta}>Este comprobante no es una factura.</Text>
    </View>
  );
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.label, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong]}>${value.toFixed(2)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: spacing.m,
    alignSelf: 'stretch',
    padding: spacing.s,
    borderRadius: radii.m,
    backgroundColor: colors.success.light,
    gap: spacing.micro,
  },
  pending: { backgroundColor: colors.warning.light },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.micro },
  share: { marginLeft: 'auto' },
  title: { fontFamily: typography.fonts.bodySemiBold, fontSize: typography.sizes.bodySmall, color: colors.text.primary },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontFamily: typography.fonts.body, fontSize: typography.sizes.bodySmall, color: colors.text.secondary },
  value: { fontFamily: typography.fonts.bodyMedium, fontSize: typography.sizes.bodySmall, color: colors.text.primary },
  strong: { fontFamily: typography.fonts.bodySemiBold, color: colors.text.primary },
  meta: { fontFamily: typography.fonts.body, fontSize: typography.sizes.caption, color: colors.text.secondary },
});
