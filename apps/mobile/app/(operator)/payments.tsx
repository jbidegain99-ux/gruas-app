import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Banknote, ChevronDown, ChevronUp } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { Card, LoadingSpinner, ErrorState } from '@/shared/components/ui';
import { formatDate } from '@/lib/dates';
import { money } from '@/lib/earnings';
import { paidInYear, parseMyPayouts, type MyPayouts } from '@/lib/payouts';
import { balanceLabel } from '@/lib/servicePayments';
import { SERVICE_TYPE_CONFIGS, type ServiceType } from '@gruas-app/shared';
import { colors, typography, spacing, radii } from '@/theme';

// Pagos recibidos (migr. 00125, backlog LAN-08): cuánto se le pagó al socio,
// cuándo y por qué servicios, y lo que todavía se le debe.

// `paid_on` es una fecha sin hora: anclada al mediodía no cambia de día al
// mostrarse en hora de El Salvador.
const day = (d: string) => formatDate(`${d}T12:00:00`);

export default function OperatorPayments() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<MyPayouts | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc('my_payouts');
    setError(!!e);
    if (!e) setData(parseMyPayouts(d));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const year = new Date().getFullYear();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.m }]}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Volver" hitSlop={12}>
          <ArrowLeft size={22} color={colors.text.primary} />
        </Pressable>
        <Text style={styles.title}>Pagos recibidos</Text>
      </View>

      {error ? (
        <ErrorState onRetry={load} fullScreen />
      ) : !data ? (
        <LoadingSpinner />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {data.company ? (
            <Card variant="default" padding="m">
              <Text style={styles.note}>
                Budi le paga a tu empresa, {data.company.replace(/\.+$/, '')}. Los pagos a ti los hace ella.
              </Text>
            </Card>
          ) : (
            <View style={styles.summary}>
              <View style={styles.summaryItem}>
                {/* 00133: si cobró en efectivo más de lo que Budi le debía, el saldo es comisión a favor de Budi. */}
                <Text style={styles.summaryValue}>{money(balanceLabel(data.pending).amount)}</Text>
                <Text style={styles.summaryLabel}>{balanceLabel(data.pending).label}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{money(paidInYear(data, year))}</Text>
                <Text style={styles.summaryLabel}>Cobrado en {year}</Text>
              </View>
            </View>
          )}

          {data.payments.length === 0 && !data.company ? (
            <View style={styles.empty}>
              <Banknote size={36} color={colors.text.secondary} strokeWidth={1.5} />
              <Text style={styles.emptyText}>
                Todavía no hay pagos. Budi paga por transferencia a la cuenta que registraste, con el detalle de cada servicio.
              </Text>
            </View>
          ) : (
            data.payments.map((p) => {
              const expanded = open === p.id;
              return (
                <Card key={p.id} variant="default" padding="m" onPress={() => setOpen(expanded ? null : p.id)}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.amount}>{money(p.amount)}</Text>
                      <Text style={styles.meta}>
                        {day(p.paid_on)} · {p.payer}
                        {p.reference ? ` · ${p.reference}` : ''}
                      </Text>
                    </View>
                    {p.services.length > 0 &&
                      (expanded ? <ChevronUp size={20} color={colors.text.secondary} /> : <ChevronDown size={20} color={colors.text.secondary} />)}
                  </View>
                  {p.services.length > 0 && !expanded && (
                    <Text style={styles.meta}>{p.services.length} servicio(s) · toca para ver</Text>
                  )}
                  {expanded &&
                    p.services.map((s, i) => (
                      <View key={i} style={styles.service}>
                        <Text style={styles.serviceText}>
                          {s.folio ?? '—'} · {SERVICE_TYPE_CONFIGS[(s.service_type || 'tow') as ServiceType]?.name ?? s.service_type}
                        </Text>
                        <Text style={styles.serviceText}>
                          {formatDate(s.completed_at)} · {money(s.amount)}
                        </Text>
                      </View>
                    ))}
                </Card>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.secondary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.m,
    backgroundColor: colors.background.primary,
  },
  title: { fontFamily: typography.fonts.heading, fontSize: typography.sizes.h3, color: colors.text.primary },
  content: { padding: spacing.l, gap: spacing.m },
  summary: {
    flexDirection: 'row',
    backgroundColor: colors.background.primary,
    borderRadius: radii.l,
    paddingVertical: spacing.m,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 2 },
  summaryDivider: { width: 1, backgroundColor: colors.border.light },
  summaryValue: { fontFamily: typography.fonts.heading, fontSize: typography.sizes.h3, color: colors.text.primary },
  summaryLabel: { fontFamily: typography.fonts.body, fontSize: typography.sizes.caption, color: colors.text.secondary },
  note: { fontFamily: typography.fonts.body, fontSize: typography.sizes.bodySmall, color: colors.text.secondary },
  empty: { alignItems: 'center', gap: spacing.s, paddingVertical: spacing.xl },
  emptyText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  amount: { fontFamily: typography.fonts.heading, fontSize: typography.sizes.h3, color: colors.text.primary },
  meta: { fontFamily: typography.fonts.body, fontSize: typography.sizes.caption, color: colors.text.secondary, marginTop: 2 },
  service: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.s,
    paddingTop: spacing.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.light,
  },
  serviceText: { fontFamily: typography.fonts.body, fontSize: typography.sizes.caption, color: colors.text.primary },
});
