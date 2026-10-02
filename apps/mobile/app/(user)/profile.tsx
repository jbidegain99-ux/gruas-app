import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Modal,
  RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogOut, Pencil, AlertCircle, HelpCircle, Car } from 'lucide-react-native';
import Constants from 'expo-constants';
import { DeleteAccountRow } from '@/features/account/components/DeleteAccountRow';
import { ExportDataRow } from '@/features/account/components/ExportDataRow';
import { supabase, signOut } from '@/lib/supabase';
import { confirmAction } from '@/lib/confirm';
import { openSupportMenu } from '@/lib/support';
import { BudiLogo, Button, Card, Input, LoadingSpinner, ToastHost, toast } from '@/shared/components/ui';
import { formatDate as formatAppDate } from '@/lib/dates';
import { colors, typography, spacing, radii } from '@/theme';
import { formatPhone } from '@gruas-app/shared';

type Profile = {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  role: string;
  created_at: string;
};

export default function Profile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchProfile = useCallback(async () => {
    setError(null);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        setError('No se pudo obtener la información del usuario');
        setLoading(false);
        return;
      }

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, phone, role, created_at')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.error('Error fetching profile:', profileError);
        setError('No se pudo cargar el perfil');
        setLoading(false);
        return;
      }

      setProfile({
        id: data.id,
        email: user.email || '',
        full_name: data.full_name,
        phone: data.phone,
        role: data.role,
        created_at: data.created_at,
      });
    } catch (err) {
      console.error('Error:', err);
      setError('Error de conexión');
    }

    setLoading(false);
  }, []);

  // Al enfocar la pestana, no solo al montar: si el perfil cambia (p. ej. se
  // edita el nombre o el telefono) esta pantalla queda montada como tab y sin
  // esto mostraria los datos viejos hasta reiniciar la app.
  useFocusEffect(
    useCallback(() => {
      fetchProfile();
    }, [fetchProfile])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProfile();
    setRefreshing(false);
  };

  const handleLogout = () => {
    confirmAction({
      title: 'Cerrar sesión',
      message: '¿Estás seguro de que deseas cerrar sesión?',
      confirmText: 'Cerrar sesión',
      destructive: true,
      onConfirm: async () => {
        await signOut();
        router.replace('/(auth)/login');
      },
    });
  };

  const openEditModal = () => {
    if (profile) {
      setEditName(profile.full_name);
      setEditPhone(formatPhone(profile.phone));
      setEditModalVisible(true);
    }
  };

  const handleSaveProfile = async () => {
    if (!editName.trim()) {
      toast.error('El nombre es obligatorio.');
      return;
    }

    if (!editPhone.trim()) {
      toast.error('El teléfono es obligatorio.');
      return;
    }

    // Teléfono de El Salvador: 8 dígitos, opcionalmente con código +503.
    if (!/^(\+?503)?\d{8}$/.test(editPhone.replace(/[\s\-()]/g, ''))) {
      toast.error('Ingresa un teléfono válido de 8 dígitos.', 'Teléfono inválido');
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: editName.trim(),
          phone: editPhone.trim(),
        })
        .eq('id', profile?.id);

      if (error) {
        console.error('Error updating profile:', error);
        toast.error('No se pudo actualizar el perfil.');
        setSaving(false);
        return;
      }

      // Update local state
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              full_name: editName.trim(),
              phone: editPhone.trim(),
            }
          : null
      );

      setEditModalVisible(false);
      toast.success('Perfil actualizado correctamente.');
    } catch (err) {
      console.error('Error:', err);
      toast.error('Error de conexión. Intenta de nuevo.');
    }

    setSaving(false);
  };

  const formatDate = (dateString: string) =>
    formatAppDate(dateString, { day: '2-digit', month: 'long', year: 'numeric' });

  const getRoleLabel = (role: string) => {
    const roleLabels: Record<string, string> = {
      USER: 'Usuario',
      OPERATOR: 'Socio operador',
      ADMIN: 'Administrador',
    };
    return roleLabels[role] || role;
  };

  if (loading) {
    return <LoadingSpinner fullScreen />;
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <AlertCircle size={48} color={colors.error.main} strokeWidth={1.5} />
        <Text style={styles.errorTitle}>Error</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Button title="Reintentar" onPress={fetchProfile} size="medium" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Perfil no encontrado</Text>
        <Button title="Cerrar sesión" onPress={handleLogout} size="medium" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.l }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header with logo */}
      <View style={styles.headerTop}>
        <BudiLogo variant="icon" height={28} />
      </View>

      {/* Profile Header */}
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarText}>
            {profile.full_name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
              .substring(0, 2)}
          </Text>
        </View>
        <Text style={styles.userName}>{profile.full_name}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{getRoleLabel(profile.role)}</Text>
        </View>
      </View>

      {/* Info Card */}
      <Card variant="default" padding="l">
        <Text style={styles.cardTitle}>Información Personal</Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Nombre Completo</Text>
          <Text style={styles.infoValue}>{profile.full_name}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Correo electrónico</Text>
          <Text style={styles.infoValue}>{profile.email}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Teléfono</Text>
          <Text style={styles.infoValue}>{formatPhone(profile.phone)}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Miembro desde</Text>
          <Text style={styles.infoValue}>{formatDate(profile.created_at)}</Text>
        </View>

        <Button
          title="Editar Perfil"
          onPress={openEditModal}
          variant="secondary"
          size="medium"
          icon={<Pencil size={16} color={colors.primary[500]} />}
        />
      </Card>

      {/* Actions Card */}
      <View style={styles.actionsCard}>
        <Card variant="default" padding="l">
          <Text style={styles.cardTitle}>Cuenta</Text>
          <Pressable style={styles.actionRow} onPress={() => router.push('/(user)/vehicles')}>
            <Car size={18} color={colors.primary[500]} />
            <Text style={styles.helpText}>Mis Vehículos</Text>
          </Pressable>
          <View style={styles.actionDivider} />
          <Pressable style={styles.actionRow} onPress={openSupportMenu}>
            <HelpCircle size={18} color={colors.primary[500]} />
            <Text style={styles.helpText}>Ayuda y Soporte</Text>
          </Pressable>
          <View style={styles.actionDivider} />
          <Pressable style={styles.actionRow} onPress={handleLogout}>
            <LogOut size={18} color={colors.error.main} />
            <Text style={styles.logoutText}>Cerrar sesión</Text>
          </Pressable>
          <View style={styles.actionDivider} />
          {/* Apple y Google exigen poder borrar la cuenta desde la app (migr. 00101). */}
          {/* Decreto 144: copia de los datos (migr. 00139). */}
          <ExportDataRow />
          <View style={styles.actionDivider} />
          <DeleteAccountRow />
        </Card>
      </View>

      {/* App Info */}
      <View style={styles.appInfo}>
        <BudiLogo variant="wordmark" height={20} color={colors.text.tertiary} />
        <Text style={styles.appVersion}>Versión {Constants.expoConfig?.version ?? '—'}</Text>
      </View>

      {/* Edit Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setEditModalVisible(false)}>
              <Text style={styles.modalCancel}>Cancelar</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Editar Perfil</Text>
            <Pressable
              onPress={handleSaveProfile}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Guardar"
              accessibilityState={{ disabled: saving, busy: saving }}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.primary[500]} />
              ) : (
                <Text style={styles.modalSave}>Guardar</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.modalContent}>
            <Input
              label="Nombre Completo"
              placeholder="Tu nombre completo"
              value={editName}
              onChangeText={setEditName}
              maxLength={120}
              autoCapitalize="words"
            />

            <View style={styles.modalInputSpacer} />

            <Input
              label="Teléfono"
              placeholder="Tu número de teléfono"
              value={editPhone}
              onChangeText={setEditPhone}
              keyboardType="phone-pad"
            />

            <Text style={styles.inputHint}>
              El correo electrónico no se puede modificar.
            </Text>
          </View>
          {/* Los toasts se pintan sobre el Modal nativo, no detrás. */}
          <ToastHost />
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
  },
  content: {
    padding: spacing.l,
    paddingBottom: spacing.xxxl,
  },
  headerTop: {
    marginBottom: spacing.m,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    gap: spacing.s,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    padding: spacing.xxxl,
    gap: spacing.m,
  },
  errorTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
  },
  errorText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary[500],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.s,
  },
  avatarText: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h1,
    color: colors.text.inverse,
  },
  userName: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  roleBadge: {
    backgroundColor: colors.primary[50],
    paddingVertical: spacing.micro,
    paddingHorizontal: spacing.s,
    borderRadius: radii.full,
  },
  roleText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.primary[500],
  },
  cardTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
    marginBottom: spacing.m,
  },
  infoRow: {
    marginBottom: spacing.m,
  },
  infoLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    marginBottom: spacing.micro,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
  },
  actionsCard: {
    marginTop: spacing.m,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingVertical: spacing.s,
  },
  logoutText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.body,
    color: colors.error.main,
  },
  helpText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.body,
    color: colors.primary[500],
  },
  actionDivider: {
    height: 1,
    backgroundColor: colors.border.light,
    marginVertical: spacing.xs,
  },
  appInfo: {
    alignItems: 'center',
    marginTop: spacing.xl,
    gap: spacing.micro,
  },
  appVersion: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
    marginTop: spacing.micro,
  },
  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.l,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  modalCancel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
  },
  modalTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.h4,
    color: colors.text.primary,
  },
  modalSave: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.primary[500],
  },
  modalContent: {
    padding: spacing.l,
  },
  modalInputSpacer: {
    height: spacing.m,
  },
  inputHint: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
    marginTop: spacing.m,
    textAlign: 'center',
  },
});
