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
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogOut, Pencil, AlertCircle, HelpCircle, ShieldCheck, Clock, ShieldX, ShieldAlert, ClipboardList, ChevronRight, GraduationCap } from 'lucide-react-native';
import Constants from 'expo-constants';
import { DeleteAccountRow } from '@/features/account/components/DeleteAccountRow';
import { ExportDataRow } from '@/features/account/components/ExportDataRow';
import { PartnerGuide } from '@/features/partners/components/PartnerGuide';
import { supabase, signOut } from '@/lib/supabase';
import { confirmAction } from '@/lib/confirm';
import { openSupportMenu } from '@/lib/support';
import { partnerStateFromProfile, pauseInfo } from '@/lib/partnerApplication';
import { BudiLogo, Button, Card, Input, LoadingSpinner, toast } from '@/shared/components/ui';
import { colors, typography, spacing, radii } from '@/theme';
import { formatPhone } from '@gruas-app/shared';

type Profile = {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  role: string;
  created_at: string;
  provider_name: string | null;
  verification_status: string;
  verification_submitted_at: string | null;
  verification_rejection_reason: string | null;
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
  const [guide, setGuide] = useState(false);

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

      // Fetch profile with provider info
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select(`
          id, full_name, phone, role, created_at, verification_status, verification_submitted_at, verification_rejection_reason,
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
        verification_status: data.verification_status || 'pending',
        verification_submitted_at: data.verification_submitted_at ?? null,
        verification_rejection_reason: data.verification_rejection_reason ?? null,
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
      setError('Error de conexión');
    }

    setLoading(false);
  }, []);

  // Al enfocar la pestana, no solo al montar: los stats (total/activos/
  // completados) cambian mientras la app esta abierta y esta pantalla queda
  // montada como tab, asi que sin esto mostraba numeros viejos hasta reiniciar.
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
      toast.error('Escribe tu nombre.');
      return;
    }

    if (!editPhone.trim()) {
      toast.error('Escribe tu teléfono.');
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
        toast.error('No se pudo actualizar el perfil. Intenta de nuevo.');
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
      toast.success('Perfil actualizado.');
    } catch (err) {
      console.error('Error:', err);
      toast.error('Revisa tu conexión e intenta de nuevo.', 'Sin conexión');
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
          <Text style={styles.roleText}>Socio</Text>
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

      {/* Estado de verificación */}
      {(() => {
        // Estado del registro de socio. Rechazado y suspendido llevan al registro
        // para corregir (ahí se ve el motivo), no a soporte.
        const state = partnerStateFromProfile(profile.verification_status, profile.verification_submitted_at);
        const config = {
          approved: { Icon: ShieldCheck, color: colors.success.main, bg: colors.success.light, title: 'Cuenta verificada', text: 'Tu cuenta está aprobada. Puedes recibir solicitudes cuando estés en línea.', cta: 'Ver mi registro' },
          in_review: { Icon: Clock, color: colors.warning.dark, bg: colors.warning.light, title: 'Registro en revisión', text: 'Un administrador está revisando tu registro. Te avisaremos cuando esté aprobado.', cta: 'Ver mi registro' },
          rejected: { Icon: ShieldX, color: colors.error.main, bg: colors.error.light, title: 'Registro rechazado', text: 'Revisa el motivo, corrige lo que se indica y vuelve a enviarlo.', cta: 'Corregir mi registro' },
          suspended: { Icon: ShieldAlert, color: colors.error.main, bg: colors.error.light, ...pauseInfo(profile.verification_rejection_reason) },
          draft: { Icon: ClipboardList, color: colors.warning.dark, bg: colors.warning.light, title: 'Completa tu registro', text: 'Llena tus datos, tu unidad y tus documentos para poder recibir solicitudes.', cta: 'Continuar mi registro' },
        }[state];
        const cta = config.cta;
        return (
          <Pressable
            style={[styles.verifCard, { backgroundColor: config.bg, borderColor: config.color }]}
            onPress={() =>
              state === 'suspended' && !pauseInfo(profile.verification_rejection_reason).byDocuments
                ? openSupportMenu()
                : router.push('/(operator)/verification' as Href)
            }
            accessibilityRole="button"
            accessibilityLabel={`Verificación: ${config.title}. ${cta}`}
          >
            <config.Icon size={22} color={config.color} strokeWidth={2} />
            <View style={styles.verifTextWrap}>
              <Text style={[styles.verifTitle, { color: config.color }]}>{config.title}</Text>
              <Text style={styles.verifText}>{config.text}</Text>
              <Text style={[styles.verifCta, { color: config.color }]}>{cta}</Text>
            </View>
            <ChevronRight size={20} color={config.color} strokeWidth={2} />
          </Pressable>
        );
      })()}

      {/* Info Card */}
      <Card variant="default" padding="l">
        <Text style={styles.cardTitle}>Información Personal</Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Nombre Completo</Text>
          <Text style={styles.infoValue}>{profile.full_name}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Correo Electrónico</Text>
          <Text style={styles.infoValue}>{profile.email}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Teléfono</Text>
          <Text style={styles.infoValue}>{formatPhone(profile.phone)}</Text>
        </View>

        {profile.provider_name && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Proveedor</Text>
            <Text style={styles.infoValue}>{profile.provider_name}</Text>
          </View>
        )}

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Socio desde</Text>
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
          {/* AGT-05 (00137): repasar la guía o repetir la práctica. */}
          <Pressable style={styles.actionRow} onPress={() => setGuide(true)}>
            <GraduationCap size={18} color={colors.primary[500]} />
            <Text style={styles.helpText}>Guía del socio y práctica</Text>
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

      <PartnerGuide
        visible={guide}
        onClose={() => setGuide(false)}
        onPractice={() => router.push('/(operator)/practice' as Href)}
      />

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
              El correo electrónico y proveedor no pueden ser modificados aquí.
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
  verifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    padding: spacing.m,
    borderRadius: radii.l,
    borderWidth: 1,
    marginBottom: spacing.m,
  },
  verifTextWrap: {
    flex: 1,
  },
  verifTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    marginBottom: spacing.micro,
  },
  verifText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  verifCta: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.caption,
    marginTop: spacing.xs,
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
