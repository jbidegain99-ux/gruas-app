import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errorMessages';
import { rutaDeInicio } from '@/shared/hooks/useRoleGuard';
import { BudiLogo, Button, Input, toast } from '@/shared/components/ui';
import { colors, typography, spacing } from '@/theme';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      toast.error('Ingresa tu email y contraseña.');
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      toast.error(friendlyError(error, 'No se pudo iniciar sesión.'));
      return;
    }

    if (data.user) {
      // Check user role and redirect accordingly
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single();

      // Antes cualquier rol que no fuera OPERATOR caia en `(user)`, asi que un
      // admin o una aseguradora entraban a la app del cliente — donde no tienen
      // nada que hacer y ni siquiera pueden crear una solicitud (migr. 00069).
      // Ahora se resuelve por el mismo mapa que usa el guard de los grupos.
      const destino = rutaDeInicio(profile?.role);
      if (destino) {
        router.replace(destino);
      } else {
        await supabase.auth.signOut();
        toast.info(
          'Las cuentas de administrador y de aseguradora trabajan en el portal web, no en la app.',
          'Esta cuenta se usa desde la web'
        );
      }
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      toast.info(
        'Escribe tu email arriba y vuelve a tocar "¿Olvidaste tu contraseña?".',
        'Recuperar contraseña'
      );
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) {
      toast.error(friendlyError(error, 'No se pudo enviar el enlace de recuperación.'));
      return;
    }
    toast.success(
      `Si existe una cuenta con ${email}, te enviamos un enlace para restablecer tu contraseña.`,
      'Revisa tu correo'
    );
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.inner}>
          <View style={styles.header}>
            <BudiLogo variant="icon" height={48} />
            <Text style={styles.title}>Iniciar Sesión</Text>
          </View>

          <View style={styles.form}>
            <Input
              label="Email"
              placeholder="tu@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Input
              label="Contraseña"
              placeholder="Tu contraseña"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <Button
              title={loading ? 'Cargando...' : 'Iniciar Sesión'}
              onPress={handleLogin}
              loading={loading}
              disabled={loading}
            />

            <Button
              title="¿Olvidaste tu contraseña?"
              onPress={handleForgotPassword}
              variant="tertiary"
              size="small"
            />
          </View>

          <Button
            title="¿No tienes cuenta? Regístrate"
            onPress={() => router.push('/(auth)/register')}
            variant="tertiary"
            size="small"
          />
        </View>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
  },
  inner: {
    flex: 1,
    paddingHorizontal: spacing.l,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
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
});
