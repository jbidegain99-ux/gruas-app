import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  Alert,
  Linking,
  Platform,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MapPin,
  Navigation,
  Phone,
  MessageCircle,
  CheckCircle,
  XCircle,
  ClipboardList,
  Truck,
} from 'lucide-react-native';
import { SERVICE_ICONS } from '@/lib/serviceIcons';
import { supabase } from '@/lib/supabase';
import { useOperatorLocationTracking } from '@/hooks/useOperatorLocationTracking';
import { ChatScreen } from '@/components/ChatScreen';
import { SERVICE_TYPE_CONFIGS } from '@gruas-app/shared';
import type { ServiceType } from '@gruas-app/shared';
import { BudiLogo, Button, Card, Input, LoadingSpinner } from '@/components/ui';
import { colors, typography, spacing, radii } from '@/theme';

type ActiveService = {
  id: string;
  status: string;
  tow_type: string;
  incident_type: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  total_price: number | null;
  notes: string | null;
  user_id: string;
  user_name: string | null;
  user_phone: string | null;
  created_at: string;
  vehicle_photo_url: string | null;
  service_type: string;
};

const STATUS_STEPS = [
  { key: 'assigned', label: 'Asignado', nextAction: 'En Camino' },
  { key: 'en_route', label: 'En Camino', nextAction: 'Llegué' },
  { key: 'active', label: 'Servicio Activo', nextAction: 'Completar' },
  { key: 'completed', label: 'Completado', nextAction: null },
];

export default function ActiveService() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [service, setService] = useState<ActiveService | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [showPinVerification, setShowPinVerification] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  // Chat state
  const [showChat, setShowChat] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Track operator location when service is active
  const isServiceActive = service !== null &&
    ['assigned', 'en_route', 'active'].includes(service.status);

  useOperatorLocationTracking({
    isActive: isServiceActive,
    intervalMs: 15000,
    distanceInterval: 50,
  });

  const fetchActiveService = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    setCurrentUserId(user.id);

    const { data: services } = await supabase
      .from('service_requests')
      .select(`
        id,
        status,
        tow_type,
        incident_type,
        pickup_address,
        pickup_lat,
        pickup_lng,
        dropoff_address,
        dropoff_lat,
        dropoff_lng,
        total_price,
        notes,
        created_at,
        user_id,
        vehicle_photo_url,
        service_type,
        profiles!service_requests_user_id_fkey (full_name, phone)
      `)
      .eq('operator_id', user.id)
      .in('status', ['assigned', 'en_route', 'active'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (services && services.length > 0) {
      const svc = services[0];

      setService({
        id: svc.id,
        status: svc.status,
        tow_type: svc.tow_type,
        incident_type: svc.incident_type,
        pickup_address: svc.pickup_address,
        pickup_lat: svc.pickup_lat,
        pickup_lng: svc.pickup_lng,
        dropoff_address: svc.dropoff_address,
        dropoff_lat: svc.dropoff_lat,
        dropoff_lng: svc.dropoff_lng,
        total_price: svc.total_price,
        notes: svc.notes,
        created_at: svc.created_at,
        user_id: svc.user_id,
        vehicle_photo_url: svc.vehicle_photo_url,
        user_name: (svc.profiles as unknown as { full_name: string; phone: string } | null)?.full_name || null,
        user_phone: (svc.profiles as unknown as { full_name: string; phone: string } | null)?.phone || null,
        service_type: svc.service_type || 'tow',
      });
    } else {
      setService(null);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchActiveService();

    const channel = supabase
      .channel('active-service')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'service_requests',
        },
        () => {
          fetchActiveService();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchActiveService]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchActiveService();
    setRefreshing(false);
  };

  const sendUserNotification = async (userId: string, title: string, body: string, data?: Record<string, string>) => {
    try {
      const { error } = await supabase.functions.invoke('send-notification', {
        body: {
          user_id: userId,
          title,
          body,
          data,
        },
      });

      if (error) {
        console.warn('[Notificaciones] Fallo (no critico):', error.message || error);
      }
    } catch (err) {
      console.warn('[Notificaciones] Exception (no critico):', err);
    }
  };

  const getStatusNotification = (status: string): { title: string; body: string } | null => {
    switch (status) {
      case 'en_route':
        return {
          title: 'Operador en camino',
          body: 'El operador va en camino a tu ubicacion',
        };
      case 'active':
        return {
          title: 'Operador ha llegado',
          body: 'El operador ha llegado y el servicio esta en curso',
        };
      case 'completed':
        return {
          title: 'Servicio completado',
          body: 'Tu servicio ha sido completado. No olvides calificar al operador.',
        };
      default:
        return null;
    }
  };

  const updateStatus = async (newStatus: string) => {
    if (!service) return;

    setUpdating(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      Alert.alert('Error', 'Debes iniciar sesión');
      setUpdating(false);
      return;
    }

    const updateData: Record<string, unknown> = { status: newStatus };

    if (newStatus === 'completed') {
      updateData.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('service_requests')
      .update(updateData)
      .eq('id', service.id);

    if (error) {
      Alert.alert('Error', 'No se pudo actualizar el estado');
      setUpdating(false);
      return;
    }

    await supabase.from('request_events').insert({
      request_id: service.id,
      event_type: newStatus === 'en_route' ? 'en_route' : newStatus === 'active' ? 'arrived' : 'service_completed',
      created_by: user.id,
    });

    const notification = getStatusNotification(newStatus);
    if (notification && service.user_id) {
      await sendUserNotification(
        service.user_id,
        notification.title,
        notification.body,
        { request_id: service.id, status: newStatus }
      );
    }

    setUpdating(false);
    await fetchActiveService();

    if (newStatus === 'completed') {
      Alert.alert('Servicio Completado', 'El servicio ha sido completado exitosamente.', [
        {
          text: 'OK',
          onPress: () => router.replace('/(operator)'),
        },
      ]);
    }
  };

  const handleStartEnRoute = () => {
    Alert.alert(
      'Iniciar Traslado',
      'Confirma que vas en camino al lugar de recogida.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: () => updateStatus('en_route') },
      ]
    );
  };

  const handleArrived = () => {
    setShowPinVerification(true);
    setPinInput('');
  };

  const verifyPinAndArrive = async () => {
    if (!service || pinInput.length !== 4) {
      Alert.alert('Error', 'Ingresa el PIN de 4 dígitos');
      return;
    }

    setUpdating(true);

    const { data, error } = await supabase.rpc('verify_request_pin', {
      p_request_id: service.id,
      p_pin: pinInput,
    });

    if (error || !data?.valid) {
      setUpdating(false);
      Alert.alert('PIN Incorrecto', 'El PIN no coincide. Verifica con el cliente.');
      return;
    }

    setShowPinVerification(false);
    setUpdating(false);
    await updateStatus('active');
    Alert.alert('Verificado', 'PIN correcto. El servicio está ahora activo.');
  };

  const handleComplete = () => {
    Alert.alert(
      'Completar Servicio',
      '¿Confirmas que el vehículo ha sido entregado en el destino?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Completar', onPress: () => updateStatus('completed') },
      ]
    );
  };

  const openCancelModal = () => {
    setCancelReason('');
    setShowCancelModal(true);
  };

  const handleCancelService = async () => {
    if (!service) return;

    if (!cancelReason.trim()) {
      Alert.alert('Error', 'Por favor ingresa un motivo de cancelacion');
      return;
    }

    setCancelling(true);

    const { data, error } = await supabase.rpc('cancel_service_request', {
      p_request_id: service.id,
      p_reason: cancelReason.trim(),
    });

    setCancelling(false);

    if (error) {
      Alert.alert('Error', error.message || 'No se pudo cancelar el servicio');
      return;
    }

    if (data && !data.success) {
      Alert.alert('Error', data.error || 'No se pudo cancelar el servicio');
      return;
    }

    Alert.alert('Servicio Cancelado', 'El servicio ha sido cancelado.', [
      {
        text: 'OK',
        onPress: () => router.replace('/(operator)'),
      },
    ]);
    setShowCancelModal(false);
  };

  const openNavigation = async (lat: number, lng: number, label: string) => {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
      Alert.alert('Error', 'Las coordenadas de navegación no son válidas.');
      return;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      Alert.alert('Error', 'Las coordenadas están fuera de rango válido.');
      return;
    }

    const options = [
      { text: 'Cancelar', style: 'cancel' as const },
      {
        text: 'Google Maps',
        onPress: async () => {
          const googleMapsUrl = Platform.select({
            ios: `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`,
            android: `google.navigation:q=${lat},${lng}`,
          });

          if (googleMapsUrl) {
            const canOpen = await Linking.canOpenURL(googleMapsUrl);
            if (canOpen) {
              await Linking.openURL(googleMapsUrl);
              return;
            }
          }

          const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
          await Linking.openURL(webUrl);
        },
      },
      {
        text: 'Waze',
        onPress: async () => {
          const wazeUrl = `waze://?ll=${lat},${lng}&navigate=yes`;
          const canOpen = await Linking.canOpenURL(wazeUrl);

          if (canOpen) {
            await Linking.openURL(wazeUrl);
          } else {
            const webUrl = `https://www.waze.com/ul?ll=${lat},${lng}&navigate=yes`;
            await Linking.openURL(webUrl);
          }
        },
      },
    ];

    if (Platform.OS === 'ios') {
      options.splice(1, 0, {
        text: 'Apple Maps',
        onPress: async () => {
          const appleMapsUrl = `maps://?daddr=${lat},${lng}&dirflg=d`;
          await Linking.openURL(appleMapsUrl);
        },
      });
    }

    Alert.alert('Abrir navegación', `Navegar a: ${label}`, options);
  };

  const openMaps = (lat: number, lng: number, label: string) => {
    openNavigation(lat, lng, label);
  };

  const callUser = () => {
    if (service?.user_phone) {
      Linking.openURL(`tel:${service.user_phone}`);
    } else {
      Alert.alert('Sin teléfono', 'El cliente no tiene teléfono registrado');
    }
  };

  const getCurrentStep = () => {
    if (!service) return 0;
    return STATUS_STEPS.findIndex((s) => s.key === service.status);
  };

  // Show chat screen if active
  if (showChat && service && currentUserId) {
    return (
      <ChatScreen
        requestId={service.id}
        currentUserId={currentUserId}
        otherUserName={service.user_name}
        onClose={() => setShowChat(false)}
      />
    );
  }

  if (loading) {
    return <LoadingSpinner fullScreen />;
  }

  if (!service) {
    return (
      <View style={styles.emptyContainer}>
        <ClipboardList size={56} color={colors.text.tertiary} strokeWidth={1.5} />
        <Text style={styles.emptyTitle}>Sin servicio activo</Text>
        <Text style={styles.emptyText}>
          Acepta una solicitud para comenzar un servicio.
        </Text>
        <Button
          title="Ver Solicitudes"
          onPress={() => router.replace('/(operator)')}
          size="medium"
        />
      </View>
    );
  }

  const currentStep = getCurrentStep();
  const svcConfig = SERVICE_TYPE_CONFIGS[(service.service_type || 'tow') as ServiceType];
  const isTow = !service.service_type || service.service_type === 'tow';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.l }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header */}
      <View style={styles.headerTop}>
        <BudiLogo variant="icon" height={28} />
      </View>

      {/* Progress Steps */}
      <View style={styles.progressContainer}>
        {STATUS_STEPS.slice(0, 3).map((step, index) => (
          <View key={step.key} style={styles.progressStep}>
            <View
              style={[
                styles.progressDot,
                index <= currentStep && styles.progressDotActive,
              ]}
            >
              {index < currentStep && <CheckCircle size={16} color={colors.text.inverse} strokeWidth={2.5} />}
            </View>
            <Text
              style={[
                styles.progressLabel,
                index <= currentStep && styles.progressLabelActive,
              ]}
            >
              {step.label}
            </Text>
            {index < 2 && (
              <View
                style={[
                  styles.progressLine,
                  index < currentStep && styles.progressLineActive,
                ]}
              />
            )}
          </View>
        ))}
      </View>

      {/* Service Details Card */}
      <Card variant="elevated" padding="l">
        <View style={styles.cardHeader}>
          <Text style={styles.incidentType}>{service.incident_type}</Text>
          <View style={[styles.towTypeBadge, { backgroundColor: `${svcConfig?.color || colors.accent[500]}15` }]}>
            {(() => {
              const SvcIcon = SERVICE_ICONS[(service.service_type || 'tow') as ServiceType] || Truck;
              return <SvcIcon size={14} color={svcConfig?.color || colors.accent[500]} strokeWidth={2} />;
            })()}
            <Text style={[styles.towTypeText, { color: svcConfig?.color || colors.accent[500] }]}>
              {svcConfig?.name || 'Grua'}
              {isTow && ` - ${service.tow_type === 'light' ? 'Liviana' : 'Pesada'}`}
            </Text>
          </View>
        </View>

        {/* Addresses */}
        <View style={styles.addressSection}>
          <Pressable
            style={styles.addressRow}
            onPress={() => openMaps(service.pickup_lat, service.pickup_lng, 'Recogida')}
          >
            <MapPin size={14} color={colors.success.main} strokeWidth={2} />
            <View style={styles.addressContent}>
              <Text style={styles.addressLabel}>Recogida</Text>
              <Text style={styles.addressText}>{service.pickup_address}</Text>
              <Text style={styles.navigationHint}>Toca para navegar</Text>
            </View>
          </Pressable>

          <View style={styles.addressLine} />

          <Pressable
            style={styles.addressRow}
            onPress={() =>
              service.dropoff_lat && service.dropoff_lng
                ? openMaps(service.dropoff_lat, service.dropoff_lng, 'Destino')
                : null
            }
          >
            <MapPin size={14} color={colors.error.main} strokeWidth={2} />
            <View style={styles.addressContent}>
              <Text style={styles.addressLabel}>Destino</Text>
              <Text style={styles.addressText}>{service.dropoff_address}</Text>
              {service.dropoff_lat && (
                <Text style={styles.navigationHint}>Toca para navegar</Text>
              )}
            </View>
          </Pressable>
        </View>

        {/* Notes */}
        {service.notes && (
          <View style={styles.infoSection}>
            <Text style={styles.infoLabel}>Notas</Text>
            <Text style={styles.infoText}>{service.notes}</Text>
          </View>
        )}

        {/* Vehicle Photo */}
        {service.vehicle_photo_url && (
          <View style={styles.photoSection}>
            <Text style={styles.photoLabel}>Foto del Vehiculo</Text>
            <Image
              source={{ uri: service.vehicle_photo_url }}
              style={styles.vehiclePhotoLarge}
              resizeMode="cover"
            />
          </View>
        )}

        {/* Client Info */}
        <View style={styles.clientSection}>
          <View style={styles.clientInfo}>
            <Text style={styles.clientLabel}>Cliente</Text>
            <Text style={styles.clientName}>{service.user_name || 'Sin nombre'}</Text>
          </View>
          <View style={styles.clientActions}>
            <Pressable style={styles.chatButtonSmall} onPress={() => setShowChat(true)}>
              <MessageCircle size={16} color={colors.primary[500]} strokeWidth={2} />
              <Text style={styles.chatButtonSmallText}>Mensaje</Text>
            </Pressable>
            <Pressable style={styles.callButton} onPress={callUser}>
              <Phone size={16} color={colors.primary[500]} strokeWidth={2} />
              <Text style={styles.callButtonText}>Llamar</Text>
            </Pressable>
          </View>
        </View>

        {/* Price */}
        {service.total_price && (
          <View style={styles.priceSection}>
            <Text style={styles.priceLabel}>Precio Estimado</Text>
            <Text style={styles.priceValue}>${service.total_price.toFixed(2)}</Text>
          </View>
        )}
      </Card>

      {/* Action Buttons */}
      <View style={styles.actionSection}>
        {/* Navigate Button */}
        {['assigned', 'en_route'].includes(service.status) && (
          <Button
            title="Navegar al Cliente"
            onPress={() => openNavigation(service.pickup_lat, service.pickup_lng, 'Punto de Recogida')}
            variant="secondary"
            size="large"
            icon={<Navigation size={18} color={colors.primary[500]} strokeWidth={2} />}
          />
        )}

        {isTow && service.status === 'active' && service.dropoff_lat && service.dropoff_lng && (
          <Button
            title="Navegar al Destino"
            onPress={() => openNavigation(service.dropoff_lat!, service.dropoff_lng!, 'Destino')}
            variant="secondary"
            size="large"
            icon={<Navigation size={18} color={colors.primary[500]} strokeWidth={2} />}
          />
        )}

        {service.status === 'assigned' && (
          <Button
            title="Voy en Camino"
            onPress={handleStartEnRoute}
            loading={updating}
            disabled={updating}
            size="large"
          />
        )}

        {service.status === 'en_route' && (
          <Button
            title="Ya Llegué (Verificar PIN)"
            onPress={handleArrived}
            loading={updating}
            disabled={updating}
            size="large"
          />
        )}

        {service.status === 'active' && (
          <Button
            title="Completar Servicio"
            onPress={handleComplete}
            loading={updating}
            disabled={updating}
            size="large"
          />
        )}

        {/* Cancel Button */}
        {['assigned', 'en_route'].includes(service.status) && (
          <Pressable
            style={styles.cancelServiceButton}
            onPress={openCancelModal}
            disabled={updating}
          >
            <XCircle size={18} color={colors.error.main} strokeWidth={2} />
            <Text style={styles.cancelServiceButtonText}>Cancelar Servicio</Text>
          </Pressable>
        )}
      </View>

      {/* PIN Verification Modal */}
      {showPinVerification && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Verificar PIN</Text>
            <Text style={styles.modalDescription}>
              Solicita el PIN de 4 digitos al cliente para verificar tu llegada.
            </Text>

            <View style={styles.pinInputWrapper}>
              <Input
                placeholder="----"
                value={pinInput}
                onChangeText={setPinInput}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>

            <View style={styles.modalButtons}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setShowPinVerification(false)}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={styles.modalConfirmButton}
                onPress={verifyPinAndArrive}
              >
                <Text style={styles.modalConfirmText}>Verificar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Cancel Service Modal */}
      {showCancelModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Cancelar Servicio</Text>
            <Text style={styles.modalDescription}>
              Por favor indica el motivo de la cancelacion
            </Text>

            <View style={styles.cancelReasonWrapper}>
              <Input
                placeholder="Escribe el motivo..."
                value={cancelReason}
                onChangeText={setCancelReason}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.modalButtons}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setShowCancelModal(false)}
                disabled={cancelling}
              >
                <Text style={styles.modalCancelText}>Volver</Text>
              </Pressable>
              <Button
                title="Confirmar"
                onPress={handleCancelService}
                loading={cancelling}
                disabled={cancelling}
                size="medium"
              />
            </View>
          </View>
        </View>
      )}
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
    paddingBottom: spacing.xxxxl,
  },
  headerTop: {
    marginBottom: spacing.m,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxxl,
    backgroundColor: colors.background.secondary,
    gap: spacing.s,
  },
  emptyTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
  },
  emptyText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.m,
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.s,
  },
  progressStep: {
    alignItems: 'center',
    flex: 1,
  },
  progressDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.border.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressDotActive: {
    backgroundColor: colors.accent[500],
  },
  progressLabel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.micro,
    color: colors.text.tertiary,
    marginTop: spacing.micro,
    textAlign: 'center',
  },
  progressLabelActive: {
    color: colors.accent[500],
    fontFamily: typography.fonts.bodySemiBold,
  },
  progressLine: {
    position: 'absolute',
    top: 15,
    right: -25,
    width: 50,
    height: 2,
    backgroundColor: colors.border.light,
  },
  progressLineActive: {
    backgroundColor: colors.accent[500],
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.l,
  },
  incidentType: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
    flex: 1,
  },
  towTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.micro,
    paddingHorizontal: spacing.s,
    borderRadius: radii.m,
  },
  towTypeText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.caption,
  },
  addressSection: {
    marginBottom: spacing.l,
  },
  addressRow: {
    flexDirection: 'row',
    gap: spacing.s,
  },
  addressContent: {
    flex: 1,
  },
  addressLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.micro,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
  },
  addressText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginTop: 2,
  },
  navigationHint: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.micro,
    color: colors.primary[500],
    marginTop: spacing.micro,
  },
  addressLine: {
    width: 2,
    height: 24,
    backgroundColor: colors.border.light,
    marginLeft: 6,
    marginVertical: spacing.micro,
  },
  infoSection: {
    paddingTop: spacing.s,
    borderTopWidth: 1,
    borderTopColor: colors.border.light,
    marginTop: spacing.s,
  },
  infoLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
  infoText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
    marginTop: spacing.micro,
  },
  photoSection: {
    paddingTop: spacing.s,
    borderTopWidth: 1,
    borderTopColor: colors.border.light,
    marginTop: spacing.s,
  },
  photoLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
  },
  vehiclePhotoLarge: {
    width: '100%',
    height: 200,
    borderRadius: radii.l,
  },
  clientSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.border.light,
    marginTop: spacing.m,
  },
  clientInfo: {},
  clientLabel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
  clientName: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
    marginTop: 2,
  },
  clientActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.micro,
    backgroundColor: colors.primary[50],
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.s,
    borderRadius: radii.m,
  },
  callButtonText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.caption,
    color: colors.primary[500],
  },
  chatButtonSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.micro,
    backgroundColor: colors.primary[50],
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.s,
    borderRadius: radii.m,
  },
  chatButtonSmallText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.caption,
    color: colors.primary[500],
  },
  priceSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.border.light,
    marginTop: spacing.m,
  },
  priceLabel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
  },
  priceValue: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
    color: colors.accent[600],
  },
  actionSection: {
    marginTop: spacing.l,
    gap: spacing.s,
  },
  cancelServiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.m,
    borderRadius: radii.l,
    backgroundColor: colors.error.light,
    borderWidth: 1,
    borderColor: colors.error.main + '30',
  },
  cancelServiceButtonText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.error.main,
  },
  // Modals
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.l,
  },
  modalContent: {
    backgroundColor: colors.background.primary,
    borderRadius: radii.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 320,
  },
  modalTitle: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  modalDescription: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.l,
  },
  pinInputWrapper: {
    marginBottom: spacing.l,
  },
  cancelReasonWrapper: {
    marginBottom: spacing.l,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing.s,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: spacing.s,
    borderRadius: radii.m,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border.medium,
  },
  modalCancelText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
  },
  modalConfirmButton: {
    flex: 1,
    paddingVertical: spacing.s,
    borderRadius: radii.m,
    alignItems: 'center',
    backgroundColor: colors.primary[500],
  },
  modalConfirmText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.text.inverse,
  },
});
