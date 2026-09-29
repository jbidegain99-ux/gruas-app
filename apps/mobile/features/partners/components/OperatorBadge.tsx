import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BadgeCheck } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors, typography, spacing, radii } from '@/theme';

/**
 * AGT-05 (00137): insignia "Socio verificado" junto al socio asignado, en el
 * servicio del Usuario. Verificado = documentos aprobados por Budi (AGT-03).
 */
export function OperatorBadge({ requestId }: { requestId: string }) {
  const [b, setB] = useState<{ verified: boolean; completed_services: number } | null>(null);

  useEffect(() => {
    supabase.rpc('request_operator_badge', { p_request: requestId }).then(({ data, error }) => {
      setB(error ? null : (data as unknown as { verified: boolean; completed_services: number } | null));
    });
  }, [requestId]);

  if (!b?.verified) return null;
  const n = Number(b.completed_services) || 0;
  return (
    <View style={styles.badge} accessibilityLabel={`Socio verificado por Budi${n > 0 ? `, ${n} servicios completados` : ''}`}>
      <BadgeCheck size={14} color={colors.success.dark} strokeWidth={2.2} />
      <Text style={styles.text}>
        Socio verificado{n > 0 ? ` · ${n} servicio${n === 1 ? '' : 's'}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.micro,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.success.light,
    marginTop: spacing.micro,
  },
  text: { fontFamily: typography.fonts.bodySemiBold, fontSize: typography.sizes.caption, color: colors.success.dark },
});
