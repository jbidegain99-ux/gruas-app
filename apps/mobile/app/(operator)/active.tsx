import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  TextInput,
  Linking,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useOperatorLocationTracking } from '@/hooks/useOperatorLocationTracking';
import { ChatScreen } from '@/components/ChatScreen';

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
};

const STATUS_STEPS = [
  { key: 'assigned', label: 'Asignado', nextAction: 'En Camino' },
  { key: 'en_route', label: 'En Camino', nextAction: 'Llegué' },
  { key: 'active', label: 'Servicio Activo', nextAction: 'Completar' },
  { key: 'completed', label: 'Completado', nextAction: null },
];

export default function ActiveService() {
  const router = useRouter();
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
  // This sends GPS updates every 15 seconds to operator_locations table
  const isServiceActive = service !== null &&
    ['assigned', 'en_route', 'active'].includes(service.status);

  useOperatorLocationTracking({
    isActive: isServiceActive,
    intervalMs: 15000, // 15 seconds
    distanceInterval: 50, // 50 meters minimum movement
  });

  const fetchActiveService = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    // Store user ID for chat
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
        profiles!service_requests_user_id_fkey (full_name, phone)
      `)
      .eq('operator_id', user.id)
      .in('status', ['assigned', 'en_route', 'active'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (services && services.length > 0) {
      const svc = services[0];

      // Debug: Log coordinates received from database
      console.log('=== SERVICE COORDINATES FROM DB ===');
      console.log('Service ID:', svc.id);
      console.log('Pickup: lat=', svc.pickup_lat, ', lng=', svc.pickup_lng);
      console.log('Dropoff: lat=', svc.dropoff_lat, ', lng=', svc.dropoff_lng);
      console.log('Pickup address:', svc.pickup_address);
      console.log('Dropoff address:', svc.dropoff_address);

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
        user_name: (svc.profiles as unknown as { full_name: string; phone: string } | null)?.full_name || null,
        user_phone: (svc.profiles as unknown as { full_name: string; phone: string } | null)?.phone || null,
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

  // Send push notification to user
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
        console.error('Error sending notification:', error);
      }
    } catch (err) {
      console.error('Exception sending notification:', err);
    }
  };

  // Get notification message for status change
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

    // Log event
    await supabase.from('request_events').insert({
      request_id: service.id,
      event_type: newStatus === 'en_route' ? 'en_route' : newStatus === 'active' ? 'arrived' : 'service_completed',
      created_by: user.id,
    });

    // Send push notification to user
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
    // Show PIN verification modal
    setShowPinVerification(true);
    setPinInput('');
  };

  const verifyPinAndArrive = async () => {
    if (!service || pinInput.length !== 4) {
      Alert.alert('Error', 'Ingresa el PIN de 4 dígitos');
      return;
    }

    setUpdating(true);

    // Verify PIN using server-side RPC
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

  // Enhanced navigation function with platform support
  const openNavigation = async (lat: number, lng: number, label: string) => {
    // Debug: Log coordinates being used for navigation
    console.log(`=== NAVIGATION DEBUG (${label}) ===`);
    console.log('Lat:', lat, '| Type:', typeof lat);
    console.log('Lng:', lng, '| Type:', typeof lng);

    // Validate coordinates before opening navigation
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
      console.error('Invalid coordinates for navigation!');
      Alert.alert('Error', 'Las coordenadas de navegación no son válidas.');
      return;
    }

    // Validate coordinates are within valid ranges
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      console.error('Coordinates out of valid range!', { lat, lng });
      Alert.alert('Error', 'Las coordenadas están fuera de rango válido.');
      return;
    }

    const options = [
      { text: 'Cancelar', style: 'cancel' as const },
      {
        text: 'Google Maps',
        onPress: async () => {
          // Try native Google Maps app first
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

          // Fallback to web Google Maps
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
            // Waze not installed, fallback to web
            const webUrl = `https://www.waze.com/ul?ll=${lat},${lng}&navigate=yes`;
            await Linking.openURL(webUrl);
          }
        },
      },
    ];

    // Add Apple Maps option on iOS
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

  // Quick navigation - opens Google Maps directly without menu
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
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  if (!service) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📋</Text>
        <Text style={styles.emptyTitle}>Sin servicio activo</Text>
        <Text style={styles.emptyText}>
          Acepta una solicitud para comenzar un servicio.
        </Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.replace('/(operator)')}
        >
          <Text style={styles.backButtonText}>Ver Solicitudes</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentStep = getCurrentStep();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
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
              {index < currentStep && <Text style={styles.checkmark}>✓</Text>}
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
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.incidentType}>{service.incident_type}</Text>
          <View style={styles.towTypeBadge}>
            <Text style={styles.towTypeText}>
              {service.tow_type === 'light' ? 'Liviana' : 'Pesada'}
            </Text>
          </View>
        </View>

        {/* Addresses */}
        <View style={styles.addressSection}>
          <TouchableOpacity
            style={styles.addressRow}
            onPress={() => openMaps(service.pickup_lat, service.pickup_lng, 'Recogida')}
          >
            <View style={styles.addressDot} />
            <View style={styles.addressContent}>
              <Text style={styles.addressLabel}>Recogida</Text>
              <Text style={styles.addressText}>{service.pickup_address}</Text>
              <Text style={styles.navigationHint}>Toca para navegar</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.addressLine} />

          <TouchableOpacity
            style={styles.addressRow}
            onPress={() =>
              service.dropoff_lat && service.dropoff_lng
                ? openMaps(service.dropoff_lat, service.dropoff_lng, 'Destino')
                : null
            }
          >
            <View style={[styles.addressDot, styles.destinationDot]} />
            <View style={styles.addressContent}>
              <Text style={styles.addressLabel}>Destino</Text>
              <Text style={styles.addressText}>{service.dropoff_address}</Text>
              {service.dropoff_lat && (
                <Text style={styles.navigationHint}>Toca para navegar</Text>
              )}
            </View>
          </TouchableOpacity>
        </View>

        {/* Notes (may include vehicle description) */}
        {service.notes && (
          <View style={styles.infoSection}>
            <Text style={styles.infoLabel}>Notas</Text>
            <Text style={styles.infoText}>{service.notes}</Text>
          </View>
        )}

        {/* Client Info */}
        <View style={styles.clientSection}>
          <View style={styles.clientInfo}>
            <Text style={styles.clientLabel}>Cliente</Text>
            <Text style={styles.clientName}>{service.user_name || 'Sin nombre'}</Text>
          </View>
          <View style={styles.clientActions}>
            <TouchableOpacity
              style={styles.chatButtonSmall}
              onPress={() => setShowChat(true)}
            >
              <Text style={styles.chatButtonSmallText}>Mensaje</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.callButton} onPress={callUser}>
              <Text style={styles.callButtonText}>Llamar</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Price */}
        {service.total_price && (
          <View style={styles.priceSection}>
            <Text style={styles.priceLabel}>Precio Estimado</Text>
            <Text style={styles.priceValue}>${service.total_price.toFixed(2)}</Text>
          </View>
        )}
      </View>

      {/* Action Buttons */}
      <View style={styles.actionSection}>
        {/* Navigate Button - shows target based on current status */}
        {['assigned', 'en_route'].includes(service.status) && (
          <TouchableOpacity
            style={[styles.actionButton, styles.navigateButton]}
            onPress={() => openNavigation(service.pickup_lat, service.pickup_lng, 'Punto de Recogida')}
          >
            <Text style={styles.actionButtonText}>Navegar al Cliente</Text>
          </TouchableOpacity>
        )}

        {service.status === 'active' && service.dropoff_lat && service.dropoff_lng && (
          <TouchableOpacity
            style={[styles.actionButton, styles.navigateButton]}
            onPress={() => openNavigation(service.dropoff_lat!, service.dropoff_lng!, 'Destino')}
          >
            <Text style={styles.actionButtonText}>Navegar al Destino</Text>
          </TouchableOpacity>
        )}

        {service.status === 'assigned' && (
          <TouchableOpacity
            style={[styles.actionButton, styles.enRouteButton]}
            onPress={handleStartEnRoute}
            disabled={updating}
          >
            {updating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionButtonText}>Voy en Camino</Text>
            )}
          </TouchableOpacity>
        )}

        {service.status === 'en_route' && (
          <TouchableOpacity
            style={[styles.actionButton, styles.arrivedButton]}
            onPress={handleArrived}
            disabled={updating}
          >
            {updating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionButtonText}>Ya Llegué (Verificar PIN)</Text>
            )}
          </TouchableOpacity>
        )}

        {service.status === 'active' && (
          <TouchableOpacity
            style={[styles.actionButton, styles.completeButton]}
            onPress={handleComplete}
            disabled={updating}
          >
            {updating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionButtonText}>Completar Servicio</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Cancel Button - available in assigned and en_route */}
        {['assigned', 'en_route'].includes(service.status) && (
          <TouchableOpacity
            style={styles.cancelServiceButton}
            onPress={openCancelModal}
            disabled={updating}
          >
            <Text style={styles.cancelServiceButtonText}>Cancelar Servicio</Text>
          </TouchableOpacity>
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

            <TextInput
              style={styles.pinInput}
              value={pinInput}
              onChangeText={setPinInput}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="----"
              placeholderTextColor="#9ca3af"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowPinVerification(false)}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmButton}
                onPress={verifyPinAndArrive}
              >
                <Text style={styles.modalConfirmText}>Verificar</Text>
              </TouchableOpacity>
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

            <TextInput
              style={styles.cancelReasonInput}
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="Escribe el motivo..."
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowCancelModal(false)}
                disabled={cancelling}
              >
                <Text style={styles.modalCancelText}>Volver</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cancelConfirmButton, cancelling && styles.buttonDisabled]}
                onPress={handleCancelService}
                disabled={cancelling}
              >
                {cancelling ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Confirmar</Text>
                )}
              </TouchableOpacity>
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
    backgroundColor: '#f9fafb',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    backgroundColor: '#f9fafb',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    paddingHorizontal: 10,
  },
  progressStep: {
    alignItems: 'center',
    flex: 1,
  },
  progressDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressDotActive: {
    backgroundColor: '#16a34a',
  },
  checkmark: {
    color: '#fff',
    fontWeight: 'bold',
  },
  progressLabel: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
  },
  progressLabelActive: {
    color: '#16a34a',
    fontWeight: '600',
  },
  progressLine: {
    position: 'absolute',
    top: 15,
    right: -25,
    width: 50,
    height: 2,
    backgroundColor: '#e5e7eb',
  },
  progressLineActive: {
    backgroundColor: '#16a34a',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  incidentType: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    flex: 1,
  },
  towTypeBadge: {
    backgroundColor: '#f0fdf4',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  towTypeText: {
    color: '#16a34a',
    fontSize: 12,
    fontWeight: '600',
  },
  addressSection: {
    marginBottom: 20,
  },
  addressRow: {
    flexDirection: 'row',
    gap: 12,
  },
  addressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#16a34a',
    marginTop: 4,
  },
  destinationDot: {
    backgroundColor: '#dc2626',
  },
  addressContent: {
    flex: 1,
  },
  addressLabel: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  addressText: {
    fontSize: 14,
    color: '#374151',
    marginTop: 2,
  },
  navigationHint: {
    fontSize: 11,
    color: '#2563eb',
    marginTop: 4,
  },
  addressLine: {
    width: 2,
    height: 24,
    backgroundColor: '#e5e7eb',
    marginLeft: 5,
    marginVertical: 4,
  },
  infoSection: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    marginTop: 12,
  },
  infoLabel: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  infoText: {
    fontSize: 14,
    color: '#111827',
    marginTop: 4,
  },
  clientSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    marginTop: 16,
  },
  clientInfo: {},
  clientLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  clientName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginTop: 2,
  },
  clientActions: {
    flexDirection: 'row',
    gap: 8,
  },
  callButton: {
    backgroundColor: '#eff6ff',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  callButtonText: {
    color: '#2563eb',
    fontWeight: '600',
  },
  chatButtonSmall: {
    backgroundColor: '#f0fdf4',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  chatButtonSmallText: {
    color: '#16a34a',
    fontWeight: '600',
  },
  priceSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    marginTop: 16,
  },
  priceLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  priceValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  actionSection: {
    gap: 12,
  },
  actionButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  enRouteButton: {
    backgroundColor: '#7c3aed',
  },
  arrivedButton: {
    backgroundColor: '#2563eb',
  },
  completeButton: {
    backgroundColor: '#16a34a',
  },
  navigateButton: {
    backgroundColor: '#0891b2',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 320,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 20,
  },
  pinInput: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 16,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  modalCancelText: {
    color: '#374151',
    fontWeight: '600',
  },
  modalConfirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#2563eb',
  },
  modalConfirmText: {
    color: '#fff',
    fontWeight: '600',
  },
  cancelServiceButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  cancelServiceButtonText: {
    color: '#dc2626',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelReasonInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 80,
    backgroundColor: '#f9fafb',
    marginBottom: 20,
  },
  cancelConfirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#dc2626',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
