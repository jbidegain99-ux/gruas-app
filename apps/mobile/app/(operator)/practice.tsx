import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, CheckCircle2, MapPin, Navigation } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { Button, Card, PINInput, toast } from '@/shared/components/ui';
import {
  PRACTICE_PIN,
  PRACTICE_SERVICE as S,
  checkPracticePin,
  nextStep,
  progress,
  type PracticeStep,
} from '@/lib/practice';
import { colors, typography, spacing, radii } from '@/theme';

// AGT-05 (00137): servicio de práctica. Recorre el ciclo real (aceptar, ir,
// PIN, completar, cobrar) con datos de mentira. No crea solicitudes ni mueve
// dinero; al terminar queda registrado que el socio hizo la práctica.

const TITLES: Record<PracticeStep, string> = {
  offer: 'Te llegó una solicitud',
  enroute: 'Vas en camino',
  pin: 'Llegaste: pide el PIN',
  working: 'Servicio en curso',
  cash: 'Cobra el servicio',
  done: '¡Listo!',
};

export default function OperatorPractice() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<PracticeStep>('offer');
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);

  const advance = () => setStep(nextStep(step));

  const verifyPin = () => {
    const r = checkPracticePin(pin);
    if (r === 'incomplete') return toast.info('El PIN tiene 4 dígitos.');
    if (r === 'wrong') {
      setPin('');
      return toast.error('Ese no es el PIN. Pídeselo otra vez al Usuario: en la práctica es ' + PRACTICE_PIN + '.');
    }
    toast.success('PIN correcto: el servicio empezó.');
    advance();
  };

  const finish = async () => {
    setSaving(true);
    const { error } = await supabase.rpc('complete_partner_practice');
    setSaving(false);
    if (error) return toast.error('No se pudo guardar tu práctica. Intenta de nuevo.');
    advance();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.m }]}>
      <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Volver">
        <ArrowLeft size={20} color={colors.text.primary} />
        <Text style={styles.backText}>Salir de la práctica</Text>
      </Pressable>

      <Text style={styles.kicker}>Servicio de práctica · no es real</Text>
      <View style={styles.bar}><View style={[styles.barFill, { width: `${progress(step) * 100}%` }]} /></View>
      <Text style={styles.title}>{TITLES[step]}</Text>

      {step !== 'done' && (
        <Card style={styles.card}>
          <Text style={styles.service}>{S.service}</Text>
          <View style={styles.row}><MapPin size={16} color={colors.text.secondary} /><Text style={styles.text}>{S.pickup}</Text></View>
          <View style={styles.row}><Navigation size={16} color={colors.text.secondary} /><Text style={styles.text}>{S.dropoff} · {S.km} km</Text></View>
          <Text style={styles.meta}>{S.user} · {S.payer}</Text>
          <Text style={styles.price}>${S.price.toFixed(2)}</Text>
        </Card>
      )}

      {step === 'offer' && (
        <>
          <Text style={styles.hint}>Revisa servicio, distancia y quién paga antes de aceptar.</Text>
          <Button title="Aceptar solicitud" onPress={advance} />
        </>
      )}
      {step === 'enroute' && (
        <>
          <Text style={styles.hint}>
            En un servicio real la app comparte tu ubicación con el Usuario mientras vas. Cuando llegues, avísale.
          </Text>
          <Button title="Llegué al lugar" onPress={advance} />
        </>
      )}
      {step === 'pin' && (
        <>
          <Text style={styles.hint}>
            El Usuario te dice su PIN de 4 dígitos. En esta práctica te dice: <Text style={styles.strong}>{PRACTICE_PIN}</Text>
          </Text>
          <PINInput value={pin} onChangeText={setPin} />
          <View style={styles.gap} />
          <Button title="Verificar PIN" onPress={verifyPin} />
        </>
      )}
      {step === 'working' && (
        <>
          <Text style={styles.hint}>Haz el servicio. Al terminar, completa: el precio final se calcula con los km reales.</Text>
          <Button title="Completar servicio" onPress={advance} />
        </>
      )}
      {step === 'cash' && (
        <>
          <Text style={styles.hint}>
            Es particular: cobras ${S.price.toFixed(2)} en efectivo. Cuando tengas el dinero, confirma &quot;Lo recibí&quot; en el
            inicio; así el Usuario recibe su comprobante y tu liquidación cuadra.
          </Text>
          <Button title={`Lo recibí ($${S.price.toFixed(2)})`} onPress={finish} loading={saving} />
        </>
      )}
      {step === 'done' && (
        <View style={styles.done}>
          <CheckCircle2 size={56} color={colors.success.main} />
          <Text style={styles.doneText}>
            Terminaste el servicio de práctica. Ya sabes aceptar, pedir el PIN, completar y cobrar.
          </Text>
          <Button title="Volver al inicio" onPress={() => router.replace('/(operator)')} />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.secondary },
  content: { padding: spacing.l, gap: spacing.s, paddingBottom: spacing.xxxl },
  back: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  backText: { fontFamily: typography.fonts.bodyMedium, fontSize: typography.sizes.bodySmall, color: colors.text.primary },
  kicker: { fontFamily: typography.fonts.bodyMedium, fontSize: typography.sizes.caption, color: colors.warning.dark },
  bar: { height: 6, borderRadius: radii.full, backgroundColor: colors.border.light, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: colors.primary[500] },
  title: { fontFamily: typography.fonts.heading, fontSize: typography.sizes.h2, color: colors.text.primary, marginTop: spacing.xs },
  card: { gap: spacing.xs },
  service: { fontFamily: typography.fonts.bodySemiBold, fontSize: typography.sizes.body, color: colors.text.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  text: { fontFamily: typography.fonts.body, fontSize: typography.sizes.bodySmall, color: colors.text.primary, flex: 1 },
  meta: { fontFamily: typography.fonts.body, fontSize: typography.sizes.caption, color: colors.text.secondary },
  price: { fontFamily: typography.fonts.heading, fontSize: typography.sizes.h3, color: colors.text.primary },
  hint: { fontFamily: typography.fonts.body, fontSize: typography.sizes.bodySmall, color: colors.text.secondary, lineHeight: 20 },
  strong: { fontFamily: typography.fonts.bodyBold, color: colors.text.primary },
  gap: { height: spacing.xs },
  done: { alignItems: 'center', gap: spacing.m, marginTop: spacing.xl },
  doneText: { fontFamily: typography.fonts.body, fontSize: typography.sizes.body, color: colors.text.primary, textAlign: 'center' },
});
