import { useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import { Power, BellRing, KeyRound, Banknote, X } from 'lucide-react-native';
import { Button } from '@/shared/components/ui';
import { useInsurersEnabled } from '@/shared/hooks/usePlatformFeatures';
import { colors, typography, spacing, radii } from '@/theme';

/**
 * AGT-05 (00137): mini guía del socio operador. Cuatro pasos, lo esencial para
 * su primer servicio. Se abre sola la primera vez y desde el perfil.
 */
const STEPS = [
  {
    icon: Power,
    title: 'Ponte en línea',
    body: 'Activa "En línea" en el inicio. Solo así te llegan solicitudes cerca de ti y el Usuario ve dónde vas.',
  },
  {
    icon: BellRing,
    title: 'Acepta una solicitud',
    body: 'Revisa el servicio, la distancia y quién paga. Si dice "Cortesía MOPT" o "Cubierto por" una aseguradora, no le cobres al Usuario (salvo su copago).',
    // 00153: con las aseguradoras apagadas solo existe la cortesía MOPT.
    bodyNoInsurers: 'Revisa el servicio, la distancia y quién paga. Si dice "Cortesía MOPT", no le cobres al Usuario.',
  },
  {
    icon: KeyRound,
    title: 'Pide el PIN de confirmación',
    body: 'Al llegar, el Usuario te dice su PIN de 4 dígitos. Escríbelo en la app: confirma que llegaste con la persona correcta. Sin PIN no empieza el servicio.',
  },
  {
    icon: Banknote,
    title: 'Completa y cobra',
    body: 'Al terminar, toca "Completar". Si el Usuario paga en efectivo, confirma "Lo recibí" en el inicio: así recibe su comprobante y tu liquidación cuadra.',
  },
];

export function PartnerGuide({
  visible,
  onClose,
  onPractice,
}: {
  visible: boolean;
  onClose: () => void;
  onPractice?: () => void;
}) {
  const [i, setI] = useState(0);
  const insurersOn = useInsurersEnabled();
  const step = STEPS[i];
  const Icon = step.icon;
  const last = i === STEPS.length - 1;

  const close = () => {
    setI(0);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Pressable onPress={close} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Cerrar guía">
            <X size={22} color={colors.text.secondary} />
          </Pressable>
          <Text style={styles.kicker}>Guía del socio · paso {i + 1} de {STEPS.length}</Text>
          <View style={styles.iconWrap}>
            <Icon size={36} color={colors.primary[500]} strokeWidth={2} />
          </View>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.body}>
            {!insurersOn && 'bodyNoInsurers' in step && step.bodyNoInsurers ? step.bodyNoInsurers : step.body}
          </Text>
          <View style={styles.dots}>
            {STEPS.map((_, k) => (
              <View key={k} style={[styles.dot, k === i && styles.dotOn]} />
            ))}
          </View>
          <View style={styles.actions}>
            {i > 0 && <Button title="Anterior" variant="tertiary" size="medium" onPress={() => setI(i - 1)} />}
            <View style={{ flex: 1 }} />
            {last ? (
              onPractice ? (
                <Button title="Hacer servicio de práctica" size="medium" onPress={() => { close(); onPractice(); }} />
              ) : (
                <Button title="Entendido" size="medium" onPress={close} />
              )
            ) : (
              <Button title="Siguiente" size="medium" onPress={() => setI(i + 1)} />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.background.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background.primary,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.s,
  },
  close: { position: 'absolute', top: spacing.m, right: spacing.m, zIndex: 1 },
  kicker: { fontFamily: typography.fonts.bodyMedium, fontSize: typography.sizes.caption, color: colors.text.secondary },
  iconWrap: {
    width: 72, height: 72, borderRadius: radii.full, backgroundColor: colors.primary[50],
    alignItems: 'center', justifyContent: 'center', marginVertical: spacing.xs,
  },
  title: { fontFamily: typography.fonts.heading, fontSize: typography.sizes.h3, color: colors.text.primary },
  body: { fontFamily: typography.fonts.body, fontSize: typography.sizes.body, color: colors.text.secondary, lineHeight: 22 },
  dots: { flexDirection: 'row', gap: 6, marginTop: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border.medium },
  dotOn: { backgroundColor: colors.primary[500], width: 20 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginTop: spacing.m },
});
