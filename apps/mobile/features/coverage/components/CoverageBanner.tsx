import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { ShieldCheck, ShieldOff, ShieldAlert, ShieldQuestion } from 'lucide-react-native';
import type { CoverageResult } from '@gruas-app/shared';
import { colors, typography, spacing, radii } from '@/theme';

/**
 * B-11 — dice en que condicion queda el servicio respecto de la cobertura.
 *
 * Los cuatro estados se pintan SIEMPRE, incluido `error`. Ese es el punto: si la
 * verificacion falla y no mostraramos nada, la persona asumiria que su seguro la
 * cubre y se enteraria al recibir el cobro. Un banner ambar diciendo "no pudimos
 * verificar, el servicio continua" es feo y es lo correcto.
 *
 * `none` (no es afiliado) no es un problema y por eso va en gris neutro, no en
 * rojo: la mayoria de los clientes de Budi no vienen de una aseguradora.
 *
 * OJO con la diferencia entre `coverage.status` y `serviceCovered`. El status
 * responde la pregunta de B-11 —"¿es un afiliado con poliza vigente?"— y no sabe
 * nada del servicio pedido; que este entre en el plan lo decide B-13, evaluando
 * `coverage_rules`. Cuando el afiliado pide algo excluido (una cerrajeria en el
 * Plan Oro, por ejemplo) los dos son ciertos a la vez, y este banner llego a
 * decir "Cubierto por tu seguro" justo encima de un "Este servicio no lo cubre
 * tu plan". Por eso entra `serviceCovered`: con el veredicto del servicio en la
 * mano, el banner deja de prometer cobertura y solo declara la afiliacion, que
 * es el unico dato que aporta y que la caja de copago no repite.
 */
export function CoverageBanner({
  coverage,
  loading,
  serviceCovered,
}: {
  coverage: CoverageResult | null;
  loading?: boolean;
  /** ¿El plan cubre ESTE tipo de servicio? `null`/`undefined` = todavia no se sabe. */
  serviceCovered?: boolean | null;
}) {
  if (loading) {
    return (
      <View style={[styles.banner, styles.neutral]}>
        <ActivityIndicator size="small" color={colors.text.secondary} />
        <Text style={styles.texto}>Verificando tu cobertura…</Text>
      </View>
    );
  }

  if (!coverage) return null;

  const poliza = [coverage.insurer_name, coverage.plan_name, coverage.policy_number]
    .filter(Boolean)
    .join(' · ');

  switch (coverage.status) {
    case 'covered':
      // Afiliado, pero el plan no incluye este servicio: se declara el vinculo y
      // nada mas. El "cuanto pagas" lo dice CopayBreakdown, debajo.
      if (serviceCovered === false) {
        return (
          <View style={[styles.banner, styles.neutral]}>
            <ShieldCheck size={18} color={colors.text.secondary} strokeWidth={2} />
            <View style={styles.cuerpo}>
              <Text style={[styles.titulo, { color: colors.text.primary }]}>
                Afiliado a {coverage.insurer_name}
              </Text>
              <Text style={styles.texto}>
                {[coverage.plan_name, coverage.policy_number].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
        );
      }
      return (
        <View style={[styles.banner, styles.ok]}>
          <ShieldCheck size={18} color={colors.success.dark} strokeWidth={2} />
          <View style={styles.cuerpo}>
            <Text style={[styles.titulo, { color: colors.success.dark }]}>
              Cubierto por tu seguro
            </Text>
            <Text style={styles.texto}>{poliza}</Text>
          </View>
        </View>
      );

    case 'inactive':
      return (
        <View style={[styles.banner, styles.aviso]}>
          <ShieldAlert size={18} color={colors.warning.dark} strokeWidth={2} />
          <View style={styles.cuerpo}>
            <Text style={[styles.titulo, { color: colors.warning.dark }]}>
              Tu cobertura no esta vigente
            </Text>
            <Text style={styles.texto}>
              {coverage.reason ?? 'La poliza no esta activa'}. Podes solicitar el servicio y
              pagarlo como cliente particular.
            </Text>
          </View>
        </View>
      );

    case 'error':
      // El caso que da nombre al ticket. Se dice explicitamente que continua y
      // que puede cobrarse: nunca se deja que el silencio implique cobertura.
      return (
        <View style={[styles.banner, styles.aviso]}>
          <ShieldQuestion size={18} color={colors.warning.dark} strokeWidth={2} />
          <View style={styles.cuerpo}>
            <Text style={[styles.titulo, { color: colors.warning.dark }]}>
              No pudimos verificar tu cobertura
            </Text>
            <Text style={styles.texto}>
              Podes solicitar el servicio igual y lo atendemos, pero puede cobrarse como
              particular hasta que revisemos tu poliza.
            </Text>
          </View>
        </View>
      );

    case 'none':
    default:
      return (
        <View style={[styles.banner, styles.neutral]}>
          <ShieldOff size={18} color={colors.text.secondary} strokeWidth={2} />
          <View style={styles.cuerpo}>
            <Text style={[styles.titulo, { color: colors.text.primary }]}>
              Servicio particular
            </Text>
            <Text style={styles.texto}>
              No encontramos una poliza asociada a tu cuenta. Pagas el servicio directamente.
            </Text>
          </View>
        </View>
      );
  }
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
  },
  cuerpo: { flex: 1, gap: 2 },
  ok: { backgroundColor: colors.success.light, borderColor: colors.success.main },
  aviso: { backgroundColor: colors.warning.light, borderColor: colors.warning.main },
  neutral: { backgroundColor: colors.background.secondary, borderColor: colors.border.light },
  titulo: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
  },
  texto: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    lineHeight: 16,
  },
});
