import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Dimensions,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useOperatorRealtimeTracking } from '@/hooks/useOperatorRealtimeTracking';
import { useETA } from '@/hooks/useETA';
import { RatingModal } from '@/components/RatingModal';
import { ChatScreen } from '@/components/ChatScreen';
import { decodePolyline } from '@/lib/geoUtils';
import type { LatLng } from '@/lib/geoUtils';
import { SERVICE_TYPE_CONFIGS } from '@gruas-app/shared';
import type { ServiceType } from '@gruas-app/shared';

// Conditionally import react-native-maps (native only)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MapView: React.ComponentType<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Marker: React.ComponentType<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MarkerAnimated: React.ComponentType<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Polyline: React.ComponentType<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AnimatedRegion: (new (...args: unknown[]) => { timing: (config: Record<string, unknown>) => { start: () => void } }) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PROVIDER_GOOGLE: any = null;

if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Marker = Maps.Marker;
  MarkerAnimated = Maps.MarkerAnimated;
  Polyline = Maps.Polyline;
  AnimatedRegion = Maps.AnimatedRegion;
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
  dropoff_lat: number;
  dropoff_lng: number;
  total_price: number | null;
  created_at: string;
  operator_id: string | null;
  operator_name: string | null;
  provider_name: string | null;
  verification_pin: string | null;
  service_type: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  initiated: { label: 'Buscando Operador', color: '#ca8a04', bgColor: '#fef9c3' },
  assigned: { label: 'Operador Asignado', color: '#2563eb', bgColor: '#dbeafe' },
  en_route: { label: 'Grúa en Camino', color: '#7c3aed', bgColor: '#ede9fe' },
  active: { label: 'Servicio en Curso', color: '#16a34a', bgColor: '#dcfce7' },
  completed: { label: 'Completado', color: '#6b7280', bgColor: '#f3f4f6' },
  cancelled: { label: 'Cancelado', color: '#dc2626', bgColor: '#fee2e2' },
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.4);
const EDGE_PADDING = { top: 60, right: 60, bottom: 60, left: 60 };

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
  // List of pending ratings to show in UI (not popup)
  const [pendingRatings, setPendingRatings] = useState<Array<{
    id: string;
    operatorName: string | null;
    completedAt: string;
  }>>([]);

  // Chat state
  const [showChat, setShowChat] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Map state
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState<LatLng[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const animatedCoordinate = useRef<any>(null);
  const animatedInitialized = useRef(false);

  // Track operator location in real-time when request has operator assigned
  const operatorId = activeRequest?.operator_id || null;
  const showTracking = activeRequest &&
    ['assigned', 'en_route', 'active'].includes(activeRequest.status) &&
    operatorId;

  const { location: operatorLocation, lastUpdated } = useOperatorRealtimeTracking(
    showTracking ? operatorId : null
  );

  // Show ETA section when operator is assigned or en_route
  const showETASection = activeRequest &&
    ['assigned', 'en_route'].includes(activeRequest.status);

  // Only calculate ETA when we have operator location
  const canCalculateETA = showETASection &&
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
    canCalculateETA || false
  );

  // Decode polyline when ETA updates
  useEffect(() => {
    if (eta?.overviewPolyline) {
      const decoded = decodePolyline(eta.overviewPolyline);
      setRouteCoordinates(decoded);
    } else if (operatorLocation && operatorLocation.is_online && activeRequest) {
      // Fallback: straight line between operator and pickup
      setRouteCoordinates([
        { latitude: operatorLocation.lat, longitude: operatorLocation.lng },
        { latitude: activeRequest.pickup_lat, longitude: activeRequest.pickup_lng },
      ]);
    } else {
      setRouteCoordinates([]);
    }
  }, [eta?.overviewPolyline, operatorLocation?.lat, operatorLocation?.lng, activeRequest?.pickup_lat, activeRequest?.pickup_lng]);

  // Fit map to coordinates when they change
  const visibleCoordinates = useMemo(() => {
    const coords: LatLng[] = [];
    if (activeRequest) {
      coords.push({ latitude: activeRequest.pickup_lat, longitude: activeRequest.pickup_lng });
      if (activeRequest.dropoff_lat && activeRequest.dropoff_lng) {
        coords.push({ latitude: activeRequest.dropoff_lat, longitude: activeRequest.dropoff_lng });
      }
    }
    if (operatorLocation && operatorLocation.is_online) {
      coords.push({ latitude: operatorLocation.lat, longitude: operatorLocation.lng });
    }
    return coords;
  }, [activeRequest?.pickup_lat, activeRequest?.pickup_lng, activeRequest?.dropoff_lat, activeRequest?.dropoff_lng, operatorLocation?.lat, operatorLocation?.lng, operatorLocation?.is_online]);

  useEffect(() => {
    if (visibleCoordinates.length >= 2 && mapRef.current?.fitToCoordinates) {
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(visibleCoordinates, {
          edgePadding: EDGE_PADDING,
          animated: true,
        });
      }, 300);
    }
  }, [visibleCoordinates, isMapFullscreen]);

  // Animate operator marker
  useEffect(() => {
    if (!operatorLocation || !operatorLocation.is_online || !AnimatedRegion) return;

    if (!animatedInitialized.current) {
      animatedCoordinate.current = new AnimatedRegion({
        latitude: operatorLocation.lat,
        longitude: operatorLocation.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
      animatedInitialized.current = true;
    } else if (animatedCoordinate.current) {
      animatedCoordinate.current.timing({
        latitude: operatorLocation.lat,
        longitude: operatorLocation.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
        duration: 1000,
        useNativeDriver: false,
      }).start();
    }
  }, [operatorLocation?.lat, operatorLocation?.lng, operatorLocation?.is_online]);

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
        dropoff_lat,
        dropoff_lng,
        total_price,
        created_at,
        verification_pin,
        operator_id,
        service_type,
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
        dropoff_lat: req.dropoff_lat,
        dropoff_lng: req.dropoff_lng,
        total_price: req.total_price,
        created_at: req.created_at,
        verification_pin: req.verification_pin,
        operator_id: req.operator_id,
        operator_name: (req.operator as unknown as { full_name: string } | null)?.full_name || null,
        provider_name: (req.providers as unknown as { name: string } | null)?.name || null,
        service_type: req.service_type || 'tow',
      });
    } else {
      setActiveRequest(null);

      // Check for recently completed requests that need rating (within last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: completedRequests, error: completedError } = await supabase
        .from('service_requests')
        .select(`
          id,
          operator_id,
          completed_at,
          operator:profiles!service_requests_operator_id_fkey (full_name)
        `)
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .not('operator_id', 'is', null)
        .gte('completed_at', sevenDaysAgo.toISOString())
        .order('completed_at', { ascending: false })
        .limit(5);

      if (completedError) {
        console.log('[Rating] Error checking completed requests:', completedError);
        setPendingRatings([]);
      } else if (completedRequests && completedRequests.length > 0) {
        // Get IDs of already rated requests
        const requestIds = completedRequests.map(r => r.id);
        const { data: existingRatings } = await supabase
          .from('ratings')
          .select('request_id')
          .in('request_id', requestIds);

        const ratedIds = new Set(existingRatings?.map(r => r.request_id) || []);

        // Filter to only unrated requests
        const unrated = completedRequests
          .filter(req => !ratedIds.has(req.id))
          .map(req => ({
            id: req.id,
            operatorName: (req.operator as unknown as { full_name: string } | null)?.full_name || null,
            completedAt: req.completed_at || '',
          }));

        console.log('[Rating] Pending ratings:', unrated.length);
        setPendingRatings(unrated);
      } else {
        setPendingRatings([]);
      }
    }

    setLoading(false);
  }, []);

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

  // Render map content (shared between inline and fullscreen)
  const renderMapContent = (fullscreen: boolean) => {
    if (!MapView || !Marker || !activeRequest) return null;

    const OperatorMarkerComponent = MarkerAnimated && animatedCoordinate.current ? MarkerAnimated : Marker;
    const operatorCoordinate = animatedCoordinate.current && MarkerAnimated
      ? animatedCoordinate.current
      : operatorLocation
        ? { latitude: operatorLocation.lat, longitude: operatorLocation.lng }
        : null;

    const isFallback = eta?.isFallback ?? true;
    const hasDropoff = activeRequest.dropoff_lat && activeRequest.dropoff_lng;

    return (
      <MapView
        ref={mapRef}
        style={fullscreen ? styles.mapFullscreen : { width: '100%', height: MAP_HEIGHT }}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{
          latitude: activeRequest.pickup_lat,
          longitude: activeRequest.pickup_lng,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {/* Pickup Marker (green) */}
        <Marker
          coordinate={{
            latitude: activeRequest.pickup_lat,
            longitude: activeRequest.pickup_lng,
          }}
          title="Recogida"
          description={activeRequest.pickup_address}
          pinColor="green"
        />

        {/* Dropoff Marker (red) */}
        {hasDropoff && (
          <Marker
            coordinate={{
              latitude: activeRequest.dropoff_lat,
              longitude: activeRequest.dropoff_lng,
            }}
            title="Destino"
            description={activeRequest.dropoff_address}
            pinColor="red"
          />
        )}

        {/* Operator Marker (truck) */}
        {operatorLocation && operatorLocation.is_online && operatorCoordinate && (
          <OperatorMarkerComponent
            coordinate={operatorCoordinate}
            title="Tu grua"
            description={activeRequest.operator_name || 'Operador'}
            anchor={{ x: 0.5, y: 0.5 }}
            flat={true}
            rotation={operatorLocation.heading ?? 0}
          >
            <View style={styles.truckMarker}>
              <Text style={styles.truckEmoji}>🚛</Text>
            </View>
          </OperatorMarkerComponent>
        )}

        {/* Route Polyline */}
        {Polyline && routeCoordinates.length >= 2 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor="#2563eb"
            strokeWidth={4}
            lineDashPattern={isFallback ? [10, 5] : undefined}
          />
        )}
      </MapView>
    );
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
          {activeRequest ? 'Tienes una solicitud activa' : 'Necesitas ayuda?'}
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
              {renderMapContent(false)}

              {/* Expand button */}
              <TouchableOpacity
                style={styles.mapExpandButton}
                onPress={() => setIsMapFullscreen(true)}
              >
                <Text style={styles.mapExpandIcon}>⛶</Text>
              </TouchableOpacity>

              {operatorLocation && operatorLocation.is_online ? (
                <View style={styles.trackingInfo}>
                  <View style={styles.trackingDot} />
                  <Text style={styles.trackingText}>
                    Ubicacion en vivo
                    {lastUpdated && ` • ${Math.round((Date.now() - lastUpdated.getTime()) / 1000)}s`}
                  </Text>
                </View>
              ) : (
                <View style={styles.trackingInfoOffline}>
                  <Text style={styles.trackingTextOffline}>
                    Esperando ubicacion del operador...
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Fullscreen Map Modal */}
          {showTracking && MapView && (
            <Modal
              visible={isMapFullscreen}
              animationType="slide"
              onRequestClose={() => setIsMapFullscreen(false)}
            >
              <View style={styles.mapContainerFullscreen}>
                {renderMapContent(true)}

                {/* Close button */}
                <TouchableOpacity
                  style={styles.mapCloseButton}
                  onPress={() => setIsMapFullscreen(false)}
                >
                  <Text style={styles.mapCloseIcon}>✕</Text>
                </TouchableOpacity>

                {/* Tracking info overlay */}
                <View style={styles.fullscreenTrackingOverlay}>
                  {operatorLocation && operatorLocation.is_online ? (
                    <View style={styles.trackingInfo}>
                      <View style={styles.trackingDot} />
                      <Text style={styles.trackingText}>
                        Ubicacion en vivo
                        {lastUpdated && ` • ${Math.round((Date.now() - lastUpdated.getTime()) / 1000)}s`}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.trackingInfoOffline}>
                      <Text style={styles.trackingTextOffline}>
                        Esperando ubicacion del operador...
                      </Text>
                    </View>
                  )}
                  {eta && (
                    <View style={styles.fullscreenEtaBar}>
                      <Text style={styles.fullscreenEtaText}>
                        ETA: {eta.etaText} — {eta.distanceText}{eta.isFallback ? ' (aprox.)' : ''}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </Modal>
          )}

          {/* ETA Display */}
          {showETASection && (
            <View style={styles.etaContainer}>
              {!operatorLocation || !operatorLocation.is_online ? (
                <View style={styles.etaLoading}>
                  <ActivityIndicator size="small" color="#7c3aed" />
                  <Text style={styles.etaLoadingText}>Obteniendo ubicacion del operador...</Text>
                </View>
              ) : etaLoading ? (
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
              ) : (
                <View style={styles.etaLoading}>
                  <Text style={styles.etaLoadingText}>ETA no disponible</Text>
                </View>
              )}
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
                    Operador en linea
                    {lastUpdated && ` • Actualizado hace ${Math.round((Date.now() - lastUpdated.getTime()) / 1000)}s`}
                  </Text>
                </View>
              ) : (
                <View style={styles.trackingInfoOffline}>
                  <Text style={styles.trackingTextOffline}>
                    Esperando ubicacion del operador...
                  </Text>
                </View>
              )}
              {/* ETA for web */}
              {showETASection && eta && (
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
              <Text style={styles.detailLabel}>Tipo de Servicio</Text>
              <Text style={styles.detailValue}>
                {(() => {
                  const cfg = SERVICE_TYPE_CONFIGS[(activeRequest.service_type || 'tow') as ServiceType];
                  const isTow = !activeRequest.service_type || activeRequest.service_type === 'tow';
                  return `${cfg?.emoji || '🚛'} ${cfg?.name || 'Grua'}${isTow ? ` - ${activeRequest.tow_type === 'light' ? 'Liviana' : 'Pesada'}` : ''}`;
                })()}
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
              </View>
            )}

            {/* Chat Button - show when operator is assigned */}
            {activeRequest.operator_id && ['assigned', 'en_route', 'active'].includes(activeRequest.status) && (
              <TouchableOpacity
                style={styles.chatButtonLarge}
                onPress={() => setShowChat(true)}
              >
                <Text style={styles.chatButtonIcon}>💬</Text>
                <Text style={styles.chatButtonLargeText}>Chat con Operador</Text>
              </TouchableOpacity>
            )}

            {activeRequest.verification_pin && activeRequest.status === 'en_route' && (
              <View style={styles.pinSection}>
                <Text style={styles.pinLabel}>PIN de Verificacion</Text>
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
            <Text style={styles.ctaTitle}>Solicitar Servicio</Text>
            <Text style={styles.ctaDescription}>
              Estamos listos para ayudarte las 24 horas del dia, los 7 dias de la semana.
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
              <Text style={styles.infoTitle}>Rapido</Text>
              <Text style={styles.infoText}>Respuesta en minutos</Text>
            </View>
            <View style={styles.infoCard}>
              <Text style={styles.infoIcon}>💰</Text>
              <Text style={styles.infoTitle}>Precios Justos</Text>
              <Text style={styles.infoText}>Sin sorpresas</Text>
            </View>
          </View>

          {/* Pending Ratings Section */}
          {pendingRatings.length > 0 && (
            <View style={styles.pendingRatingsSection}>
              <Text style={styles.pendingRatingsTitle}>Califica tus servicios</Text>
              <Text style={styles.pendingRatingsSubtitle}>
                Tienes {pendingRatings.length} servicio{pendingRatings.length > 1 ? 's' : ''} sin calificar
              </Text>
              {pendingRatings.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.pendingRatingCard}
                  onPress={() => {
                    setCompletedRequestForRating({
                      id: item.id,
                      operatorName: item.operatorName,
                    });
                    setShowRatingModal(true);
                  }}
                >
                  <View style={styles.pendingRatingInfo}>
                    <Text style={styles.pendingRatingOperator}>
                      {item.operatorName || 'Operador'}
                    </Text>
                    <Text style={styles.pendingRatingDate}>
                      {new Date(item.completedAt).toLocaleDateString('es-ES', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </Text>
                  </View>
                  <View style={styles.pendingRatingStars}>
                    <Text style={styles.pendingRatingStarsText}>⭐ Calificar</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
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
            // Refresh to update pending ratings list
            fetchActiveRequest();
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
  chatButtonLarge: {
    marginTop: 12,
    backgroundColor: '#16a34a',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  chatButtonIcon: {
    fontSize: 20,
  },
  chatButtonLargeText: {
    color: '#fff',
    fontSize: 16,
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
  mapFullscreen: {
    flex: 1,
  },
  mapContainerFullscreen: {
    flex: 1,
    backgroundColor: '#000',
  },
  mapExpandButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
    zIndex: 10,
  },
  mapExpandIcon: {
    fontSize: 20,
    color: '#111827',
  },
  mapCloseButton: {
    position: 'absolute',
    top: 50,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 10,
  },
  mapCloseIcon: {
    fontSize: 20,
    color: '#111827',
    fontWeight: 'bold',
  },
  fullscreenTrackingOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingBottom: 34,
  },
  fullscreenEtaBar: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#faf5ff',
    alignItems: 'center',
  },
  fullscreenEtaText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#581c87',
  },
  truckMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  truckEmoji: {
    fontSize: 24,
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
  // Pending Ratings Styles
  pendingRatingsSection: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#fffbeb',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  pendingRatingsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#92400e',
    marginBottom: 4,
  },
  pendingRatingsSubtitle: {
    fontSize: 14,
    color: '#b45309',
    marginBottom: 12,
  },
  pendingRatingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  pendingRatingInfo: {
    flex: 1,
  },
  pendingRatingOperator: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  pendingRatingDate: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  pendingRatingStars: {
    backgroundColor: '#fef3c7',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  pendingRatingStarsText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#92400e',
  },
});
