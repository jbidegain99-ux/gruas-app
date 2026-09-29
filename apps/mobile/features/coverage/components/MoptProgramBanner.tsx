import { View, Text, StyleSheet } from 'react-native';
import { Landmark } from 'lucide-react-native';
import { colors, typography, spacing, radii } from '@/theme';

/**
 * Quién absorbe el costo de un servicio cortesía. El video (backlog VID-02) lo
 * nombra así; si el programa cambia de nombre se cambia aquí.
 */
export const FONDO_VIAL_LABEL = 'Fondo Vial MOPT';

/**
 * El pedido lo cubre un programa MOPT (migr. 00098): la persona no paga nada.
 * Reemplaza al banner de "Servicio particular" cuando aplica, para que la
 * pantalla no se contradiga.
 *
 * Con el precio conocido muestra el desglose del video: costo real del
 * servicio, absorbido por el Fondo Vial MOPT, y $0.00 a pagar. La comisión de
 * Budi nunca aparece aquí (regla del backlog).
 */
export function MoptProgramBanner({
  programName,
  estimatedPrice,
}: {
  programName?: string;
  /** Precio del servicio, si ya se conoce. Se muestra para que se entienda qué cubre. */
  estimatedPrice?: number | null;
}) {
  return (
    <View style={styles.banner}>
      <Landmark size={18} color={colors.success.dark} strokeWidth={2} />
      <View style={styles.cuerpo}>
        <Text style={styles.titulo}>Sin costo para ti</Text>
        <Text style={styles.texto}>
          Este servicio lo cubre {programName ?? 'el programa de asistencia vial del MOPT'}.
        </Text>
        {estimatedPrice != null && estimatedPrice > 0 && <MoptBreakdown price={estimatedPrice} />}
      </View>
    </View>
  );
}

/** Costo del servicio / Absorbido por Fondo Vial MOPT / Pagas $0.00. */
export function MoptBreakdown({ price }: { price: number }) {
  const money = (n: number) => `$${n.toFixed(2)}`;
  return (
    <View style={styles.desglose} accessibilityLabel={`Costo del servicio ${money(price)}, absorbido por ${FONDO_VIAL_LABEL}. Pagas $0.00`}>
      <View style={styles.fila}>
        <Text style={styles.texto}>Costo del servicio</Text>
        <Text style={styles.monto}>{money(price)}</Text>
      </View>
      <View style={styles.fila}>
        <Text style={styles.texto}>Absorbido por {FONDO_VIAL_LABEL}</Text>
        <Text style={styles.absorbido}>−{money(price)}</Text>
      </View>
      <View style={[styles.fila, styles.total]}>
        <Text style={styles.aPagarLabel}>Pagas</Text>
        <Text style={styles.aPagar}>$0.00</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s,
    padding: spacing.m,
    borderRadius: radii.m,
    borderWidth: 1,
    marginBottom: spacing.m,
    backgroundColor: colors.success.light,
    borderColor: colors.success.main,
  },
  cuerpo: { flex: 1, gap: 2 },
  titulo: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.success.dark,
  },
  texto: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    lineHeight: 16,
  },
  desglose: { marginTop: spacing.xs, gap: 2 },
  fila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  monto: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.primary,
  },
  absorbido: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.success.dark,
  },
  total: {
    marginTop: 2,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.success.main,
  },
  aPagarLabel: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
  },
  aPagar: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.success.dark,
  },
});
