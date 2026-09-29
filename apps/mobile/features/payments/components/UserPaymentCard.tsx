import { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Wallet } from 'lucide-react-native';
import { SERVICE_TYPE_CONFIGS, type ServiceType } from '@gruas-app/shared';
import { Card } from '@/shared/components/ui';
import { colors, typography, spacing } from '@/theme';
import { fetchMyPendingPayments, type PendingItem } from '../lib/payments';

/**
 * Lo que el Usuario tiene pendiente de pagar (migr. 00133, LAN-07): el
 * servicio particular completo o su copago. Hoy se paga en efectivo al socio
 * operador, que confirma y dispara el comprobante; la tarjeta llega con la
 * pasarela. Si no debe nada, no se muestra.
 */
export function UserPaymentCard() {
  const [items, setItems] = useState<PendingItem[]>([]);
  useFocusEffect(
    useCallback(() => {
      fetchMyPendingPayments().then(setItems);
    }, []),
  );

  if (items.length === 0) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Wallet size={20} color={colors.primary[500]} strokeWidth={2} />
        <Text style={styles.title}>Pago pendiente</Text>
      </View>
      {items.map((it) => (
        <View key={it.request_id} style={styles.row}>
          <Text style={styles.amount}>${it.amount.toFixed(2)}</Text>
          <Text style={styles.meta}>
            {SERVICE_TYPE_CONFIGS[it.service_type as ServiceType]?.name ?? 'Servicio'}
            {it.folio ? ` · ${it.folio}` : ''}
          </Text>
        </View>
      ))}
      <Text style={styles.hint}>
        Págale en efectivo a tu socio operador. Cuando lo confirme, tu comprobante aparecerá en el historial.
        Pronto también podrás pagar con tarjeta.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.m, borderLeftWidth: 4, borderLeftColor: colors.primary[500] },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  title: { fontFamily: typography.fonts.bodySemiBold, fontSize: typography.sizes.body, color: colors.text.primary },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.s, paddingVertical: spacing.micro },
  amount: { fontFamily: typography.fonts.heading, fontSize: typography.sizes.h3, color: colors.text.primary },
  meta: { fontFamily: typography.fonts.body, fontSize: typography.sizes.caption, color: colors.text.secondary },
  hint: {
    marginTop: spacing.xs,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
});
