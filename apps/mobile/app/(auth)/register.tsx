import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  ScrollView,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errorMessages';
import { LEGAL_CONFIG } from '@/config/legal';
import type { UserRole } from '@gruas-app/shared';
import { BudiLogo, Button, Input, toast } from '@/shared/components/ui';
import { colors, typography, spacing, radii } from '@/theme';

export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('USER');
  const [loading, setLoading] = useState(false);
  // Decreto 144: el aviso es requisito para usar la plataforma; el marketing es
  // opcional y va aparte. Ninguna arranca marcada — un consentimiento premarcado
  // no es "libre". Ver docs/PROTECCION_DATOS.md §5.
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  const handleRegister = async () => {
    if (!email || !password || !fullName || !phone) {
      toast.error('Completa todos los campos.');
      return;
    }

    // Validación básica antes de llamar a Supabase (evita errores crudos)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error('Escribe un email con un formato válido (ej. tu@correo.com).', 'Email inválido');
      return;
    }
    if (password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres.', 'Contraseña muy corta');
      return;
    }
    if (!privacyAccepted) {
      toast.error(
        'Debes aceptar el Aviso de privacidad para crear tu cuenta.',
        'Falta aceptar el aviso'
      );
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone,
          role,
          // El trigger handle_new_user (migr. 00041) sella la fecha de aceptación
          // y guarda el opt-in: la ley pide poder acreditar el consentimiento.
          privacy_accepted: 'true',
          marketing_opt_in: marketingOptIn,
        },
      },
    });

    setLoading(false);

    if (error) {
      console.error('Registration error:', JSON.stringify(error, null, 2));
      toast.error(friendlyError(error, 'No se pudo crear la cuenta. Intenta de nuevo.'), 'Error de registro');
      return;
    }

    if (data.user) {
      // El toast vive en la raíz: sigue visible tras navegar al login.
      toast.success('Tu cuenta fue creada. Verifica tu email para entrar.', 'Registro exitoso');
      router.replace('/(auth)/login');
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <BudiLogo variant="icon" height={44} />
            <Text style={styles.title}>Crear Cuenta</Text>
          </View>

          <View style={styles.form}>
            <Input
              label="Nombre completo"
              placeholder="Juan Pérez"
              value={fullName}
              onChangeText={setFullName}
            />

            <Input
              label="Email"
              placeholder="tu@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Input
              label="Teléfono"
              placeholder="+503 XXXX-XXXX"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            <Input
              label="Contraseña"
              placeholder="Mínimo 6 caracteres"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <Text style={styles.label}>Tipo de cuenta</Text>
            <View style={styles.roleContainer}>
              <Pressable
                style={[styles.roleButton, role === 'USER' && styles.roleButtonActive]}
                onPress={() => setRole('USER')}
              >
                <Text style={[styles.roleText, role === 'USER' && styles.roleTextActive]}>
                  Usuario
                </Text>
              </Pressable>
              <Pressable
                style={[styles.roleButton, role === 'OPERATOR' && styles.roleButtonActive]}
                onPress={() => setRole('OPERATOR')}
              >
                <Text style={[styles.roleText, role === 'OPERATOR' && styles.roleTextActive]}>
                  Socio operador
                </Text>
              </Pressable>
            </View>

            {role === 'OPERATOR' && (
              <Text style={styles.operatorNote}>
                Después de crear tu cuenta completarás tu registro de socio: datos, unidad y
                documentos. Te avisamos cuando esté aprobado.
              </Text>
            )}

            <View style={styles.consentBox}>
              <Text style={styles.consentIntro}>
                {role === 'OPERATOR'
                  ? 'Para verificar tu cuenta necesitamos tu DUI, NIT, licencia, tarjeta de circulación y póliza de seguro. Mientras estés en línea registramos tu ubicación, incluso con la app en segundo plano, para asignarte servicios cercanos.'
                  : 'Para prestarte asistencia vial tratamos tu nombre, teléfono, correo, datos de tu vehículo y tu ubicación durante el servicio. Compartimos tu nombre, teléfono y ubicación de recogida únicamente con el socio operador que te atiende.'}
              </Text>

              <Pressable
                style={styles.consentRow}
                onPress={() => setPrivacyAccepted((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: privacyAccepted }}
                accessibilityLabel="Acepto el Aviso de privacidad"
              >
                <View style={[styles.checkbox, privacyAccepted && styles.checkboxChecked]}>
                  {privacyAccepted && <Check size={14} color={colors.text.inverse} strokeWidth={3} />}
                </View>
                <Text style={styles.consentText}>
                  He leído y acepto el{' '}
                  <Text
                    style={styles.consentLink}
                    onPress={() => Linking.openURL(LEGAL_CONFIG.PRIVACY_URL)}
                  >
                    Aviso de privacidad
                  </Text>
                  .
                </Text>
              </Pressable>

              <Pressable
                style={styles.consentRow}
                onPress={() => setMarketingOptIn((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: marketingOptIn }}
                accessibilityLabel="Quiero recibir promociones y novedades"
              >
                <View style={[styles.checkbox, marketingOptIn && styles.checkboxChecked]}>
                  {marketingOptIn && <Check size={14} color={colors.text.inverse} strokeWidth={3} />}
                </View>
                <Text style={styles.consentText}>
                  Quiero recibir promociones y novedades de Budi.{' '}
                  <Text style={styles.consentOptional}>(opcional)</Text>
                </Text>
              </Pressable>
            </View>

            <Button
              title={loading ? 'Registrando...' : 'Registrarse'}
              onPress={handleRegister}
              loading={loading}
              disabled={loading || !privacyAccepted}
            />
          </View>

          <Button
            title="¿Ya tienes cuenta? Inicia sesión"
            onPress={() => router.push('/(auth)/login')}
            variant="tertiary"
            size="small"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.l,
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    gap: spacing.s,
  },
  title: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
    color: colors.text.primary,
    textAlign: 'center',
  },
  form: {
    gap: spacing.m,
    marginBottom: spacing.xl,
  },
  label: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
  },
  roleContainer: {
    flexDirection: 'row',
    gap: spacing.s,
  },
  roleButton: {
    flex: 1,
    paddingVertical: spacing.s,
    borderRadius: radii.m,
    borderWidth: 1.5,
    borderColor: colors.border.light,
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },
  roleButtonActive: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  roleText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
  },
  roleTextActive: {
    color: colors.primary[500],
    fontFamily: typography.fonts.bodySemiBold,
  },
  operatorNote: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    backgroundColor: colors.primary[50],
    padding: spacing.s,
    borderRadius: radii.m,
    lineHeight: 18,
  },
  consentBox: {
    backgroundColor: colors.background.secondary,
    borderRadius: radii.m,
    padding: spacing.s,
    gap: spacing.s,
  },
  consentIntro: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radii.s,
    borderWidth: 2,
    borderColor: colors.border.medium,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: colors.primary[500],
    borderColor: colors.primary[500],
  },
  consentText: {
    flex: 1,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.primary,
    lineHeight: 18,
  },
  consentLink: {
    color: colors.primary[500],
    fontFamily: typography.fonts.bodyMedium,
  },
  consentOptional: {
    color: colors.text.tertiary,
  },
});
