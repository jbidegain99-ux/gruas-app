import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Banknote } from 'lucide-react-native';
import { SERVICE_TYPE_CONFIGS, type ServiceType } from '@gruas-app/shared';
import { Button, Card, toast } from '@/shared/components/ui';
import { friendlyError } from '@/lib/errorMessages';
import { colors, typography, spacing } from '@/theme';
import { confirmCash, fetchOperatorPendingCash, type PendingItem } from '../lib/payments';

/**
 * Cobros en efectivo por confirmar (migr. 00133, LAN-07). Al completar un
 * servicio particular (o con copago), el socio cobra en mano y lo confirma
 * aquí: así su liquidación descuenta lo que ya recibió y el Usuario recibe su
 * comprobante. Si no hay nada pendiente, no se muestra.
 */
export function OperatorCashCard() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchOperatorPendingCash().then(setItems);
  }, []);
  useFocusEffect(load);

  const register = async (it: PendingItem) => {
    setBusy(it.request_id);
    try {
      await confirmCash(it.request_id);
      toast.success(`Cobro de $${it.amount.toFixed(2)} registrado.`);
      load();
    } catch (e) {
      toast.error(friendlyError(e as Error));
    } finally {
      setBusy(null);
    }
  };

  const confirm = (it: PendingItem) => {
    const title = `¿Recibiste $${it.amount.toFixed(2)} en efectivo?`;
    const body = `${it.user_name ?? 'El Usuario'} recibirá su comprobante. Confírmalo solo si ya tienes el dinero.`;
    // En web Alert.alert no hace nada (react-native-web); mismo arreglo que verification.tsx.
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${body}`)) register(it);
      return;
    }
    Alert.alert(title, body, [
      { text: 'Todavía no', style: 'cancel' },
      { text: 'Sí, lo recibí', onPress: () => register(it) },
    ]);
  };

  if (items.length === 0) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Banknote size={20} color={colors.warning.dark} strokeWidth={2} />
        <Text style={styles.title}>
          {items.length === 1 ? 'Un cobro en efectivo por confirmar' : `${items.length} cobros en efectivo por confirmar`}
        </Text>
      </View>
      {items.map((it) => (
        <View key={it.request_id} style={styles.row}>
          <View style={styles.info}>
            <Text style={styles.amount}>${it.amount.toFixed(2)}</Text>
            <Text style={styles.meta}>
              {SERVICE_TYPE_CONFIGS[it.service_type as ServiceType]?.name ?? 'Servicio'}
              {it.folio ? ` · ${it.folio}` : ''}
              {it.user_name ? ` · ${it.user_name}` : ''}
            </Text>
          </View>
          <Button title="Lo recibí" size="small" onPress={() => confirm(it)} loading={busy === it.request_id} />
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.m, borderLeftWidth: 4, borderLeftColor: colors.warning.main },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  title: { fontFamily: typography.fonts.bodySemiBold, fontSize: typography.sizes.body, color: colors.text.primary },
  // El Button del DS ocupa todo el ancho: va debajo del monto, no al lado.
  row: { gap: spacing.xs, paddingVertical: spacing.xs },
  info: { gap: 2 },
  amount: { fontFamily: typography.fonts.heading, fontSize: typography.sizes.h4, color: colors.text.primary },
  meta: { fontFamily: typography.fonts.body, fontSize: typography.sizes.caption, color: colors.text.secondary },
});
