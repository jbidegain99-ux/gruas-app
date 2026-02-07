import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import type { UserRole } from '@gruas-app/shared';
import { BudiLogo, Button, Input } from '@/components/ui';
import { colors, typography, spacing, radii } from '@/theme';

export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('USER');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!email || !password || !fullName || !phone) {
      Alert.alert('Error', 'Por favor completa todos los campos');
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
        },
      },
    });

    setLoading(false);

    if (error) {
      console.error('Registration error:', JSON.stringify(error, null, 2));
      const errorDetails = error.message || 'Error desconocido al registrar';
      const errorCode = (error as { code?: string }).code;
      const fullMessage = errorCode
        ? `${errorDetails}\n\nCódigo: ${errorCode}`
        : errorDetails;
      Alert.alert('Error de Registro', fullMessage);
      return;
    }

    if (data.user) {
      Alert.alert(
        'Registro exitoso',
        'Tu cuenta ha sido creada. Por favor verifica tu email.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }]
      );
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
              placeholder="+503 7000-0000"
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
                  Operador
                </Text>
              </Pressable>
            </View>

            <Button
              title={loading ? 'Registrando...' : 'Registrarse'}
              onPress={handleRegister}
              loading={loading}
              disabled={loading}
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
});
