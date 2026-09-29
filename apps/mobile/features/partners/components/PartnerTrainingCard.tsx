import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { GraduationCap } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { Button, Card } from '@/shared/components/ui';
import { colors, typography, spacing } from '@/theme';
import { PartnerGuide } from './PartnerGuide';

type Training = { guide_seen_at: string | null; practice_done_at: string | null; verified: boolean };

/**
 * AGT-05 (00137): invita al socio aprobado a ver la guía y hacer el servicio
 * de práctica. La guía se abre sola la primera vez. Cuando terminó las dos
 * cosas, la tarjeta desaparece.
 */
export function PartnerTrainingCard() {
  const router = useRouter();
  const [t, setT] = useState<Training | null>(null);
  const [guide, setGuide] = useState(false);
  const autoOpened = useRef(false);

  useFocusEffect(
    useCallback(() => {
      supabase.rpc('my_partner_training').then(({ data, error }) => {
        if (error || !data) return;
        const tr = data as unknown as Training;
        setT(tr);
        if (tr.verified && !tr.guide_seen_at && !autoOpened.current) {
          autoOpened.current = true;
          setGuide(true);
        }
      });
    }, []),
  );

  const closeGuide = () => {
    setGuide(false);
    supabase.rpc('mark_partner_guide_seen').then(() => setT((x) => (x ? { ...x, guide_seen_at: x.guide_seen_at ?? new Date().toISOString() } : x)));
  };
  const practice = () => router.push('/(operator)/practice' as Href);

  const show = t?.verified && !t.practice_done_at;

  return (
    <>
      <PartnerGuide visible={guide} onClose={closeGuide} onPractice={practice} />
      {show && (
        <Card style={styles.card}>
          <View style={styles.header}>
            <GraduationCap size={20} color={colors.primary[500]} strokeWidth={2} />
            <Text style={styles.title}>Aprende a usar Budi en 2 minutos</Text>
          </View>
          <Text style={styles.body}>
            Una guía corta y un servicio de práctica, sin Usuarios reales ni cobros. Así llegas listo a tu primer servicio.
          </Text>
          <View style={styles.actions}>
            <View style={styles.action}><Button title="Ver guía" variant="secondary" size="small" onPress={() => setGuide(true)} /></View>
            <View style={styles.action}><Button title="Práctica" size="small" onPress={practice} /></View>
          </View>
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.m, borderLeftWidth: 4, borderLeftColor: colors.primary[500] },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  title: { fontFamily: typography.fonts.bodySemiBold, fontSize: typography.sizes.body, color: colors.text.primary },
  body: { fontFamily: typography.fonts.body, fontSize: typography.sizes.bodySmall, color: colors.text.secondary },
  actions: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.s },
  action: { flex: 1 },
});
