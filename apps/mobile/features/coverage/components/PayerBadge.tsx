import { View, Text, StyleSheet } from 'react-native';
import { ShieldCheck, Landmark } from 'lucide-react-native';
import { colors, typography, spacing, radii } from '@/theme';
import type { PayerInfo } from '../hooks/usePayerInfo';

/**
 * "Cortesía MOPT" / "Cubierto por XYZ" en la tarjeta del socio (LAN-06).
 * Cuando lo paga el propio Usuario no se muestra nada.
 */
export function PayerBadge({ info }: { info?: PayerInfo }) {
  if (!info || info.payer === 'user' || !info.label) return null;
  const Icon = info.payer === 'mopt' ? Landmark : ShieldCheck;
  return (
    <View style={styles.badge} accessibilityLabel={`${info.label}. No le cobres al usuario${info.has_copay ? ' salvo el copago' : ''}.`}>
      <Icon size={14} color={colors.success.dark} strokeWidth={2} />
      <View style={styles.textos}>
        <Text style={styles.label}>{info.label}</Text>
        <Text style={styles.hint}>
          {info.has_copay ? 'El usuario solo paga su copago.' : 'No le cobres al usuario.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
    borderRadius: radii.m,
    backgroundColor: colors.success.light,
    marginTop: spacing.xs,
  },
  textos: { gap: 1 },
  label: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.caption,
    color: colors.success.dark,
  },
  hint: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
});
