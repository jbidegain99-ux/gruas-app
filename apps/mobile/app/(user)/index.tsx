import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useOperatorRealtimeTracking } from '@/hooks/useOperatorRealtimeTracking';
import { useETA } from '@/hooks/useETA';
import { RatingModal } from '@/components/RatingModal';
import { ChatScreen } from '@/components/ChatScreen';

// Conditionally import react-native-maps (native only)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MapView: React.ComponentType<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Marker: React.ComponentType<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PROVIDER_GOOGLE: any = null;

if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Marker = Maps.Marker;
  PROVIDER_GOOGLE = Maps.PROVIDER_GOOGLE;
}

type ActiveRequest = {
  id: string;
  status: string;
  tow_type: string;
  incident_type: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  total_price: number | null;
  created_at: string;
  operator_id: string | null;
  operator_name: string | null;
  provider_name: string | null;
  verification_pin: string | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  initiated: { label: 'Buscando Operador', color: '#ca8a04', bgColor: '#fef9c3' },
  assigned: { label: 'Operador Asignado', color: '#2563eb', bgColor: '#dbeafe' },
  en_route: { label: 'Grúa en Camino', color: '#7c3aed', bgColor: '#ede9fe' },
  active: { label: 'Servicio en Curso', color: '#16a34a', bgColor: '#dcfce7' },
  completed: { label: 'Completado', color: '#6b7280', bgColor: '#f3f4f6' },
  cancelled: { label: 'Cancelado', color: '#dc2626', bgColor: '#fee2e2' },
};

export default function UserHome() {
  const router = useRouter();
  const [activeRequest, setActiveRequest] = useState<ActiveRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userName, setUserName] = useState('');

  // Rating modal state
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [completedRequestForRating, setCompletedRequestForRating] = useState<{
    id: string;
    operatorName: string | null;
  } | null>(null);
  const lastStatusRef = useRef<string | null>(null);

  // Chat state
  const [showChat, setShowChat] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Track operator location in real-time when request has operator assigned
  const operatorId = activeRequest?.operator_id || null;
  const showTracking = activeRequest &&
    ['assigned', 'en_route', 'active'].includes(activeRequest.status) &&
    operatorId;

  const { location: operatorLocation, lastUpdated } = useOperatorRealtimeTracking(
    showTracking ? operatorId : null
  );

  // Calculate ETA when operator is en_route or assigned
  const showETA = activeRequest &&
    ['assigned', 'en_route'].includes(activeRequest.status) &&
    operatorLocation &&
    operatorLocation.is_online;

  const pickupLocation = activeRequest ? {
    lat: activeRequest.pickup_lat,
    lng: activeRequest.pickup_lng,
  } : null;

  const operatorCoords = operatorLocation ? {
    lat: operatorLocation.lat,
    lng: operatorLocation.lng,
  } : null;

  const { eta, loading: etaLoading } = useETA(
    operatorCoords,
    pickupLocation,
    showETA || false
  );

  const fetchActiveRequest = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    // Store user ID for chat
    setCurrentUserId(user.id);

    // Get user name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    if (profile?.full_name) {
      setUserName(profile.full_name.split(' ')[0]);
    }

    // Get active requests
    const { data: requests } = await supabase
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
        total_price,
        created_at,
        verification_pin,
        operator_id,
        operator:profiles!service_requests_operator_id_fkey (full_name),
        providers (name)
      `)
      .eq('user_id', user.id)
      .in('status', ['initiated', 'assigned', 'en_route', 'active'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (requests && requests.length > 0) {
      const req = requests[0];
      setActiveRequest({
        id: req.id,
        status: req.status,
        tow_type: req.tow_type,
        incident_type: req.incident_type,
        pickup_address: req.pickup_address,
        pickup_lat: req.pickup_lat,
        pickup_lng: req.pickup_lng,
        dropoff_address: req.dropoff_address,
        total_price: req.total_price,
        created_at: req.created_at,
        verification_pin: req.verification_pin,
        operator_id: req.operator_id,
        operator_name: (req.operator as unknown as { full_name: string } | null)?.full_name || null,
        provider_name: (req.providers as unknown as { name: string } | null)?.name || null,
      });
    } else {
      setActiveRequest(null);

      // Check for recently completed requests that need rating
      const { data: completedRequests } = await supabase
        .from('service_requests')
        .select(`
          id,
          operator_id,
          operator:profiles!service_requests_operator_id_fkey (full_name)
        `)
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1);

      if (completedRequests && completedRequests.length > 0) {
        const completedReq = completedRequests[0];

        // Check if already rated
        const { data: existingRating } = await supabase
          .from('ratings')
          .select('id')
          .eq('request_id', completedReq.id)
          .maybeSingle();

        if (!existingRating && !showRatingModal) {
          setCompletedRequestForRating({
            id: completedReq.id,
            operatorName: (completedReq.operator as unknown as { full_name: string } | null)?.full_name || null,
          });
          setShowRatingModal(true);
        }
      }
    }

    setLoading(false);
  }, [showRatingModal]);

  useEffect(() => {
    fetchActiveRequest();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('user-requests')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'service_requests',
        },
        () => {
          fetchActiveRequest();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchActiveRequest]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchActiveRequest();
    setRefreshing(false);
  };

  // Show chat screen if active
  if (showChat && activeRequest && currentUserId) {
    return (
      <ChatScreen
        requestId={activeRequest.id}
        currentUserId={currentUserId}
        otherUserName={activeRequest.operator_name}
        onClose={() => setShowChat(false)}
      />
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  const statusConfig = activeRequest ? STATUS_CONFIG[activeRequest.status] : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>Hola{userName ? `, ${userName}` : ''}</Text>
        <Text style={styles.subtitle}>
          {activeRequest ? 'Tienes una solicitud activa' : 'Necesitas una grúa?'}
        </Text>
      </View>

      {activeRequest ? (
        // Active Request Card
        <View style={styles.activeCard}>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusConfig?.bgColor || '#f3f4f6' },
            ]}
          >
            <View
              style={[styles.statusDot, { backgroundColor: statusConfig?.color || '#6b7280' }]}
            />
            <Text style={[styles.statusText, { color: statusConfig?.color || '#6b7280' }]}>
              {statusConfig?.label || activeRequest.status}
            </Text>
          </View>

          {/* Live Map Tracking (Native only) */}
          {showTracking && MapView && Marker && (
            <View style={styles.mapContainer}>
              <MapView
                style={styles.map}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                initialRegion={{
                  latitude: activeRequest.pickup_lat,
                  longitude: activeRequest.pickup_lng,
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                }}
                region={operatorLocation ? {
                  latitude: (activeRequest.pickup_lat + operatorLocation.lat) / 2,
                  longitude: (activeRequest.pickup_lng + operatorLocation.lng) / 2,
                  latitudeDelta: Math.abs(activeRequest.pickup_lat - operatorLocation.lat) * 2 + 0.02,
                  longitudeDelta: Math.abs(activeRequest.pickup_lng - operatorLocation.lng) * 2 + 0.02,
                } : undefined}
              >
                {/* Pickup Location Marker */}
                <Marker
                  coordinate={{
                    latitude: activeRequest.pickup_lat,
                    longitude: activeRequest.pickup_lng,
                  }}
                  title="Tu ubicación"
                  description={activeRequest.pickup_address}
                  pinColor="green"
                />

                {/* Operator Location Marker */}
                {operatorLocation && operatorLocation.is_online && (
                  <Marker
                    coordinate={{
                      latitude: operatorLocation.lat,
                      longitude: operatorLocation.lng,
                    }}
                    title="Tu grúa"
                    description={activeRequest.operator_name || 'Operador'}
                    pinColor="blue"
                  />
                )}
              </MapView>

              {operatorLocation && operatorLocation.is_online ? (
                <View style={styles.trackingInfo}>
                  <View style={styles.trackingDot} />
                  <Text style={styles.trackingText}>
                    Ubicación en vivo
                    {lastUpdated && ` • ${Math.round((Date.now() - lastUpdated.getTime()) / 1000)}s`}
                  </Text>
                </View>
              ) : (
                <View style={styles.trackingInfoOffline}>
                  <Text style={styles.trackingTextOffline}>
                    Esperando ubicación del operador...
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ETA Display */}
          {showETA && (
            <View style={styles.etaContainer}>
              {etaLoading ? (
                <View style={styles.etaLoading}>
                  <ActivityIndicator size="small" color="#7c3aed" />
                  <Text style={styles.etaLoadingText}>Calculando tiempo...</Text>
                </View>
              ) : eta ? (
                <>
                  <Text style={styles.etaLabel}>Tiempo estimado de llegada</Text>
                  <Text style={styles.etaValue}>{eta.etaText}</Text>
                  <Text style={styles.etaDistance}>
                    {eta.distanceText} de distancia
                    {eta.isFallback && ' (aprox.)'}
                  </Text>
                </>
              ) : null}
            </View>
          )}

          {/* Web fallback - show tracking status without map */}
          {showTracking && !MapView && (
            <View style={styles.webTrackingContainer}>
              <Text style={styles.webTrackingTitle}>Seguimiento en tiempo real</Text>
              {operatorLocation && operatorLocation.is_online ? (
                <View style={styles.trackingInfo}>
                  <View style={styles.trackingDot} />
                  <Text style={styles.trackingText}>
                    Operador en línea
                    {lastUpdated && ` • Actualizado hace ${Math.round((Date.now() - lastUpdated.getTime()) / 1000)}s`}
                  </Text>
                </View>
              ) : (
                <View style={styles.trackingInfoOffline}>
                  <Text style={styles.trackingTextOffline}>
                    Esperando ubicación del operador...
                  </Text>
                </View>
              )}
              {/* ETA for web */}
              {showETA && eta && (
                <View style={styles.etaContainerWeb}>
                  <Text style={styles.etaLabel}>Tiempo estimado</Text>
                  <Text style={styles.etaValue}>{eta.etaText}</Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.requestDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Tipo de Incidente</Text>
              <Text style={styles.detailValue}>{activeRequest.incident_type}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Tipo de Grúa</Text>
              <Text style={styles.detailValue}>
                {activeRequest.tow_type === 'light' ? 'Liviana' : 'Pesada'}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Recogida</Text>
              <Text style={styles.detailValue} numberOfLines={2}>
                {activeRequest.pickup_address}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Destino</Text>
              <Text style={styles.detailValue} numberOfLines={2}>
                {activeRequest.dropoff_address}
              </Text>
            </View>

            {activeRequest.operator_name && (
              <View style={styles.operatorSection}>
                <Text style={styles.operatorLabel}>Operador Asignado</Text>
                <Text style={styles.operatorName}>{activeRequest.operator_name}</Text>
                {activeRequest.provider_name && (
                  <Text style={styles.providerName}>{activeRequest.provider_name}</Text>
                )}
                {/* Chat Button */}
                {['assigned', 'en_route', 'active'].includes(activeRequest.status) && (
                  <TouchableOpacity
                    style={styles.chatButton}
                    onPress={() => setShowChat(true)}
                  >
                    <Text style={styles.chatButtonText}>Enviar mensaje</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {activeRequest.verification_pin && activeRequest.status === 'en_route' && (
              <View style={styles.pinSection}>
                <Text style={styles.pinLabel}>PIN de Verificación</Text>
                <Text style={styles.pinValue}>{activeRequest.verification_pin}</Text>
                <Text style={styles.pinHint}>
                  Comparte este PIN con el operador cuando llegue
                </Text>
              </View>
            )}

            {activeRequest.total_price && (
              <View style={styles.priceSection}>
                <Text style={styles.priceLabel}>Precio Estimado</Text>
                <Text style={styles.priceValue}>${activeRequest.total_price.toFixed(2)}</Text>
              </View>
            )}
          </View>

          <View style={styles.requestIdRow}>
            <Text style={styles.requestIdLabel}>ID:</Text>
            <Text style={styles.requestId}>{activeRequest.id.substring(0, 8)}</Text>
          </View>
        </View>
      ) : (
        // No Active Request - Show CTA
        <View style={styles.ctaContainer}>
          <View style={styles.ctaCard}>
            <Text style={styles.ctaIcon}>🚗</Text>
            <Text style={styles.ctaTitle}>Solicitar Grúa</Text>
            <Text style={styles.ctaDescription}>
              Estamos listos para ayudarte las 24 horas del día, los 7 días de la semana.
            </Text>
            <TouchableOpacity
              style={styles.ctaButton}
              onPress={() => router.push('/(user)/request')}
            >
              <Text style={styles.ctaButtonText}>Solicitar Ahora</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoCards}>
            <View style={styles.infoCard}>
              <Text style={styles.infoIcon}>⏱️</Text>
              <Text style={styles.infoTitle}>Rápido</Text>
              <Text style={styles.infoText}>Respuesta en minutos</Text>
            </View>
            <View style={styles.infoCard}>
              <Text style={styles.infoIcon}>💰</Text>
              <Text style={styles.infoTitle}>Precios Justos</Text>
              <Text style={styles.infoText}>Sin sorpresas</Text>
            </View>
          </View>
        </View>
      )}

      {/* Rating Modal */}
      {completedRequestForRating && (
        <RatingModal
          visible={showRatingModal}
          requestId={completedRequestForRating.id}
          operatorName={completedRequestForRating.operatorName}
          onClose={() => {
            setShowRatingModal(false);
            setCompletedRequestForRating(null);
          }}
          onSubmitted={() => {
            setShowRatingModal(false);
            setCompletedRequestForRating(null);
            router.push('/(user)/history');
          }}
        />
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
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
    marginTop: 4,
  },
  activeCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  requestDetails: {
    marginTop: 20,
    gap: 16,
  },
  detailRow: {
    gap: 4,
  },
  detailLabel: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 15,
    color: '#111827',
  },
  operatorSection: {
    marginTop: 8,
    padding: 12,
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
  },
  operatorLabel: {
    fontSize: 12,
    color: '#16a34a',
    fontWeight: '500',
  },
  operatorName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginTop: 4,
  },
  providerName: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  chatButton: {
    marginTop: 12,
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  chatButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  pinSection: {
    marginTop: 8,
    padding: 16,
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    alignItems: 'center',
  },
  pinLabel: {
    fontSize: 12,
    color: '#2563eb',
    fontWeight: '500',
  },
  pinValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1e40af',
    letterSpacing: 8,
    marginTop: 8,
  },
  pinHint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 8,
    textAlign: 'center',
  },
  priceSection: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  requestIdRow: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  requestIdLabel: {
    fontSize: 12,
    color: '#9ca3af',
  },
  requestId: {
    fontSize: 12,
    color: '#9ca3af',
    fontFamily: 'monospace',
  },
  ctaContainer: {
    gap: 16,
  },
  ctaCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  ctaIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  ctaTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  ctaDescription: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  ctaButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  ctaButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  infoCards: {
    flexDirection: 'row',
    gap: 12,
  },
  infoCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  infoIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  mapContainer: {
    marginTop: 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
  },
  map: {
    width: '100%',
    height: 200,
  },
  trackingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    backgroundColor: '#dcfce7',
    gap: 6,
  },
  trackingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16a34a',
  },
  trackingText: {
    fontSize: 12,
    color: '#16a34a',
    fontWeight: '500',
  },
  trackingInfoOffline: {
    padding: 8,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
  },
  trackingTextOffline: {
    fontSize: 12,
    color: '#92400e',
  },
  webTrackingContainer: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#f0f9ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  webTrackingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0369a1',
    marginBottom: 8,
    textAlign: 'center',
  },
  etaContainer: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#faf5ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9d5ff',
    alignItems: 'center',
  },
  etaLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  etaLoadingText: {
    fontSize: 14,
    color: '#7c3aed',
  },
  etaLabel: {
    fontSize: 12,
    color: '#7c3aed',
    fontWeight: '500',
    marginBottom: 4,
  },
  etaValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#581c87',
  },
  etaDistance: {
    fontSize: 13,
    color: '#9333ea',
    marginTop: 4,
  },
  etaContainerWeb: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#bae6fd',
    alignItems: 'center',
  },
});
