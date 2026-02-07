import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogOut, Pencil, AlertCircle } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { BudiLogo, Button, Card, Input, LoadingSpinner } from '@/components/ui';
import { colors, typography, spacing, radii } from '@/theme';

type Profile = {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  role: string;
  created_at: string;
  provider_name: string | null;
};

type Stats = {
  total_services: number;
  completed_services: number;
  active_services: number;
};

export default function OperatorProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<Stats>({ total_services: 0, completed_services: 0, active_services: 0 });
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
        setError('No se pudo obtener la informacion del usuario');
        setLoading(false);
        return;
      }

      // Fetch profile with provider info
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select(`
          id, full_name, phone, role, created_at,
          providers (name)
        `)
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
        provider_name: (data.providers as unknown as { name: string } | null)?.name || null,
      });

      // Fetch operator stats
      const { data: statsData } = await supabase
        .from('service_requests')
        .select('status')
        .eq('operator_id', user.id);

      if (statsData) {
        const total = statsData.length;
        const completed = statsData.filter((r) => r.status === 'completed').length;
        const active = statsData.filter((r) =>
          ['assigned', 'en_route', 'active'].includes(r.status)
        ).length;

        setStats({
          total_services: total,
          completed_services: completed,
          active_services: active,
        });
      }
    } catch (err) {
      console.error('Error:', err);
      setError('Error de conexion');
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProfile();
    setRefreshing(false);
  };

  const handleLogout = () => {
    Alert.alert(
      'Cerrar Sesion',
      'Estas seguro que deseas cerrar sesion?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar Sesion',
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  const openEditModal = () => {
    if (profile) {
      setEditName(profile.full_name);
      setEditPhone(profile.phone);
      setEditModalVisible(true);
    }
  };

  const handleSaveProfile = async () => {
    if (!editName.trim()) {
      Alert.alert('Error', 'El nombre es requerido');
      return;
    }

    if (!editPhone.trim()) {
      Alert.alert('Error', 'El telefono es requerido');
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
        Alert.alert('Error', 'No se pudo actualizar el perfil');
        setSaving(false);
        return;
      }

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
      Alert.alert('Exito', 'Perfil actualizado correctamente');
    } catch (err) {
      console.error('Error:', err);
      Alert.alert('Error', 'Error de conexion');
    }

    setSaving(false);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
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
        <Button title="Cerrar Sesion" onPress={handleLogout} size="medium" />
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
          <Text style={styles.roleText}>Operador</Text>
        </View>
        {profile.provider_name && (
          <Text style={styles.providerName}>{profile.provider_name}</Text>
        )}
      </View>

      {/* Stats Cards */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.total_services}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={[styles.statCard, styles.statCardActive]}>
          <Text style={[styles.statValue, styles.statValueActive]}>{stats.active_services}</Text>
          <Text style={[styles.statLabel, styles.statLabelActive]}>Activos</Text>
        </View>
        <View style={[styles.statCard, styles.statCardCompleted]}>
          <Text style={[styles.statValue, styles.statValueCompleted]}>{stats.completed_services}</Text>
          <Text style={[styles.statLabel, styles.statLabelCompleted]}>Completados</Text>
        </View>
      </View>

      {/* Info Card */}
      <Card variant="default" padding="l">
        <Text style={styles.cardTitle}>Informacion Personal</Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Nombre Completo</Text>
          <Text style={styles.infoValue}>{profile.full_name}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Correo Electronico</Text>
          <Text style={styles.infoValue}>{profile.email}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Telefono</Text>
          <Text style={styles.infoValue}>{profile.phone}</Text>
        </View>

        {profile.provider_name && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Proveedor</Text>
            <Text style={styles.infoValue}>{profile.provider_name}</Text>
          </View>
        )}

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Operador desde</Text>
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
          <Pressable style={styles.actionRow} onPress={handleLogout}>
            <LogOut size={18} color={colors.error.main} />
            <Text style={styles.logoutText}>Cerrar Sesion</Text>
          </Pressable>
        </Card>
      </View>

      {/* App Info */}
      <View style={styles.appInfo}>
        <BudiLogo variant="wordmark" height={20} color={colors.text.tertiary} />
        <Text style={styles.appVersion}>Version 1.0.0</Text>
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
            <Pressable onPress={handleSaveProfile} disabled={saving}>
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
              autoCapitalize="words"
            />

            <View style={styles.modalInputSpacer} />

            <Input
              label="Telefono"
              placeholder="Tu numero de telefono"
              value={editPhone}
              onChangeText={setEditPhone}
              keyboardType="phone-pad"
            />

            <Text style={styles.inputHint}>
              El correo electronico y proveedor no pueden ser modificados aqui.
            </Text>
          </View>
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
    backgroundColor: colors.accent[500],
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
    backgroundColor: colors.accent[50],
    paddingVertical: spacing.micro,
    paddingHorizontal: spacing.s,
    borderRadius: radii.full,
  },
  roleText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.accent[500],
  },
  providerName: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.s,
    marginBottom: spacing.m,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.background.primary,
    borderRadius: radii.l,
    padding: spacing.m,
    alignItems: 'center',
  },
  statCardActive: {
    backgroundColor: colors.primary[50],
  },
  statCardCompleted: {
    backgroundColor: colors.success.light,
  },
  statValue: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
    color: colors.text.primary,
    marginBottom: spacing.micro,
  },
  statValueActive: {
    color: colors.primary[500],
  },
  statValueCompleted: {
    color: colors.success.main,
  },
  statLabel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
  statLabelActive: {
    color: colors.primary[500],
  },
  statLabelCompleted: {
    color: colors.success.main,
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
