import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Dimensions,
  Modal,
  Alert,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '@/lib/supabase';
import { useOperatorRealtimeTracking } from '@/features/tracking/hooks/useOperatorRealtimeTracking';
import { useETA } from '@/features/tracking/hooks/useETA';
import { useGPSSimulator } from '@/features/tracking/hooks/useGPSSimulator';
import { RatingModal } from '@/features/rating/components/RatingModal';
import { ChatScreen } from '@/features/chat/components/ChatScreen';
import type { LatLng } from '@/lib/geoUtils';
import { DEMO_CONFIG } from '@/config/demo';
import { MAP_CONFIG } from '@/config/map';
import { useTrackingRoute } from '@/features/tracking/hooks/useTrackingRoute';
import { useActiveRequest } from '@/features/tracking/hooks/useActiveRequest';
import { MiniMap } from '@/shared/components/MiniMap';
import { AddressText } from '@/shared/components/AddressText';
import { cancellationPolicyMessage } from '@/lib/cancellation';
import { getPin } from '@/features/pin/lib/pinStorage';
import { friendlyError } from '@/lib/errorMessages';
import { SERVICE_TYPE_CONFIGS } from '@gruas-app/shared';
import type { ServiceRequestStatus, ServiceType } from '@gruas-app/shared';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Star, MessageCircle, MapPin, Maximize2, Truck, X, Clock, DollarSign, Phone, Copy, CheckCircle2 } from 'lucide-react-native';
import { SERVICE_ICONS } from '@/lib/serviceIcons';
import { BudiLogo, Button, Card, StatusBadge, LoadingSpinner, ErrorState } from '@/shared/components/ui';
import { colors, typography, spacing, radii } from '@/theme';

// Conditionally import react-native-maps (native only)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MapView: React.ComponentType<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Marker: React.ComponentType<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MarkerAnimated: React.ComponentType<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Polyline: React.ComponentType<any> | null = null;
let AnimatedRegion: (new (...args: unknown[]) => { timing: (config: Record<string, unknown>) => { start: () => void } }) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PROVIDER_GOOGLE: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let UrlTile: any = null;
let mapsLoadError: string | null = null;

if (Platform.OS !== 'web') {
  try {
    const Maps = require('react-native-maps');
    MapView = Maps.default;
    Marker = Maps.Marker;
    MarkerAnimated = Maps.MarkerAnimated;
    Polyline = Maps.Polyline;
    AnimatedRegion = Maps.AnimatedRegion;
    PROVIDER_GOOGLE = Maps.PROVIDER_GOOGLE;
    UrlTile = Maps.UrlTile;
  } catch (e) {
    mapsLoadError = e instanceof Error ? e.message : 'Failed to load react-native-maps';
    console.error('[Maps] Failed to load react-native-maps:', e);
  }
}

const USE_OSM = MAP_CONFIG.TILE_SOURCE === 'osm';

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
  operator_phone: string | null;
  provider_name: string | null;
  service_type: string;
  route_polyline: string | null;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.4);
const EDGE_PADDING = { top: 60, right: 60, bottom: 60, left: 60 };

export default function UserHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    activeRequest,
    userName,
    pendingRatings,
    setPendingRatings,
    currentUserId,
    loading,
    error: activeRequestError,
    refetch: fetchActiveRequest,
  } = useActiveRequest();
  const [refreshing, setRefreshing] = useState(false);

  // Rating modal state
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [completedRequestForRating, setCompletedRequestForRating] = useState<{
    id: string;
    operatorName: string | null;
  } | null>(null);
  const lastStatusRef = useRef<string | null>(null);

  // Chat state
  const [showChat, setShowChat] = useState(false);

  // PIN de activacion: lo guardamos cifrado (SecureStore) al crear la solicitud.
  // Lo mostramos mientras la solicitud no este activada, para que el usuario
  // pueda dictarselo al operador cuando llegue.
  const [activePin, setActivePin] = useState<string | null>(null);
  const [pinCopied, setPinCopied] = useState(false);
  const requestId = activeRequest?.id ?? null;
  const requestStatus = activeRequest?.status ?? null;
  const showPin = requestStatus !== null &&
    ['initiated', 'assigned', 'en_route'].includes(requestStatus);

  useEffect(() => {
    let cancelled = false;
    setPinCopied(false);
    if (requestId && showPin) {
      getPin(requestId)
        .then((pin) => { if (!cancelled) setActivePin(pin); })
        .catch(() => { if (!cancelled) setActivePin(null); });
    } else {
      setActivePin(null);
    }
    return () => { cancelled = true; };
  }, [requestId, showPin]);

  const copyPin = async (pin: string) => {
    try {
      await Clipboard.setStringAsync(pin);
      setPinCopied(true);
    } catch {
      // Copiar es una comodidad; si falla, el PIN sigue visible en pantalla.
    }
  };

  // Aviso "esta tardando": solicitud en 'initiated' con >10 min sin actividad
  // (mismo umbral que el job del backend, migracion 00036). La push de ese job
  // no llega en Expo Go, asi que lo reflejamos tambien in-app. El tick de 30s
  // re-evalua la condicion mientras se espera.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (requestStatus !== 'initiated') return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [requestStatus]);
  const searchDelayed =
    requestStatus === 'initiated' &&
    activeRequest?.updated_at != null &&
    nowTick - new Date(activeRequest.updated_at).getTime() > 10 * 60 * 1000;

  // Map state
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  // routeCoordinatesForMap is derived via useMemo below — no state needed
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

  // Fase del servicio: en 'active' el operador ya recogio y va camino al
  // DESTINO. Antes de eso (assigned/en_route) va camino a la RECOGIDA. La ruta
  // y el ETA cambian de tramo segun esto.
  const activePhase = activeRequest?.status === 'active';

  const { location: operatorLocation, lastUpdated } = useOperatorRealtimeTracking(
    showTracking ? operatorId : null
  );

  // Show ETA section while the operator is en route to pickup OR towing to
  // the destination (active). Solo cuando hay operador siguiendose.
  const showETASection = activeRequest &&
    ['assigned', 'en_route', 'active'].includes(activeRequest.status);

  // Only calculate ETA when we have operator location
  const canCalculateETA = showETASection &&
    operatorLocation &&
    operatorLocation.is_online;

  const pickupLocation = useMemo(() =>
    activeRequest ? { lat: activeRequest.pickup_lat, lng: activeRequest.pickup_lng } : null,
    [activeRequest?.pickup_lat, activeRequest?.pickup_lng]
  );

  const dropoffLocation = useMemo(() =>
    activeRequest && activeRequest.dropoff_lat && activeRequest.dropoff_lng
      ? { lat: activeRequest.dropoff_lat, lng: activeRequest.dropoff_lng }
      : null,
    [activeRequest?.dropoff_lat, activeRequest?.dropoff_lng]
  );

  // Destino del tramo actual: en 'active' es la entrega; antes, la recogida.
  // Si por algun motivo no hay dropoff, cae de vuelta a pickup.
  const etaDestination = activePhase ? (dropoffLocation ?? pickupLocation) : pickupLocation;

  const operatorCoords = useMemo(() =>
    operatorLocation ? { lat: operatorLocation.lat, lng: operatorLocation.lng } : null,
    [operatorLocation?.lat, operatorLocation?.lng]
  );

  const { eta: realEta, loading: etaLoading } = useETA(
    operatorCoords,
    etaDestination,
    canCalculateETA || false,
    activeRequest?.id
  );

  // --- Demo Mode: GPS Simulation ---
  // Demo mode activates when: config enabled + operator assigned + trackable status
  const isDemoMode = DEMO_CONFIG.ENABLED &&
    activeRequest !== null &&
    ['assigned', 'en_route'].includes(activeRequest.status) &&
    activeRequest.operator_id !== null;

  const { simulationRoute, routeCoordinatesForMap, hasRealRoute } = useTrackingRoute({
    // "pickup" aqui es el objetivo del tramo actual: recogida, o destino en 'active'.
    pickup: etaDestination,
    // El polyline guardado es operador->recogida; en 'active' ya no aplica, se
    // usa el del ETA (operador->destino).
    storedPolyline: activePhase ? null : (activeRequest?.route_polyline ?? null),
    etaPolyline: realEta?.overviewPolyline ?? null,
    operatorLocation: operatorLocation
      ? { lat: operatorLocation.lat, lng: operatorLocation.lng, is_online: operatorLocation.is_online }
      : null,
    isDemoMode,
  });

  const simulator = useGPSSimulator({
    route: simulationRoute,
    enabled: isDemoMode && simulationRoute.length >= 2,
    speedKmh: DEMO_CONFIG.AVERAGE_SPEED_KMH,
  });

  // In demo mode, use simulated position; otherwise use real tracking
  const effectiveOperatorPosition = isDemoMode && simulator.currentPosition
    ? simulator.currentPosition
    : operatorLocation
      ? { latitude: operatorLocation.lat, longitude: operatorLocation.lng }
      : null;

  // In demo mode, use simulated ETA; otherwise use real ETA
  const eta = isDemoMode
    ? (realEta ? {
        ...realEta,
        etaMinutes: simulator.etaMinutes,
        etaText: `~${simulator.etaMinutes} min`,
        distanceKm: simulator.remainingDistanceKm,
        distanceText: `${simulator.remainingDistanceKm} km`,
        isFallback: false,
      } : {
        etaMinutes: simulator.etaMinutes,
        etaText: `~${simulator.etaMinutes} min`,
        distanceKm: simulator.remainingDistanceKm,
        distanceText: `${simulator.remainingDistanceKm} km`,
        isFallback: false,
        overviewPolyline: activeRequest?.route_polyline ?? null,
      })
    : realEta;

  // Fit map to coordinates when they change
  // Use primitive values for stable deps (avoid object reference churn from simulator)
  const simLat = simulator.currentPosition?.latitude;
  const simLng = simulator.currentPosition?.longitude;

  const visibleCoordinates = useMemo(() => {
    const coords: LatLng[] = [];
    if (activeRequest) {
      coords.push({ latitude: activeRequest.pickup_lat, longitude: activeRequest.pickup_lng });
      if (activeRequest.dropoff_lat && activeRequest.dropoff_lng) {
        coords.push({ latitude: activeRequest.dropoff_lat, longitude: activeRequest.dropoff_lng });
      }
    }
    if (isDemoMode && simLat != null && simLng != null) {
      coords.push({ latitude: simLat, longitude: simLng });
    } else if (operatorLocation && operatorLocation.is_online) {
      coords.push({ latitude: operatorLocation.lat, longitude: operatorLocation.lng });
    }
    return coords;
  }, [activeRequest?.pickup_lat, activeRequest?.pickup_lng, activeRequest?.dropoff_lat, activeRequest?.dropoff_lng, isDemoMode, simLat, simLng, operatorLocation?.lat, operatorLocation?.lng, operatorLocation?.is_online]);

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

  // Animate operator marker (uses simulated position in demo mode)
  const markerLat = isDemoMode && simulator.currentPosition
    ? simulator.currentPosition.latitude
    : operatorLocation?.lat;
  const markerLng = isDemoMode && simulator.currentPosition
    ? simulator.currentPosition.longitude
    : operatorLocation?.lng;
  const markerOnline = isDemoMode ? (simulator.currentPosition !== null) : operatorLocation?.is_online;

  useEffect(() => {
    if ((!markerLat || !markerLng || !markerOnline) && !isDemoMode) return;
    if (!markerLat || !markerLng) return;
    if (!AnimatedRegion) return;

    if (!animatedInitialized.current) {
      animatedCoordinate.current = new AnimatedRegion({
        latitude: markerLat,
        longitude: markerLng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
      animatedInitialized.current = true;
    } else if (animatedCoordinate.current) {
      animatedCoordinate.current.timing({
        latitude: markerLat,
        longitude: markerLng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
        duration: 1000,
        useNativeDriver: false,
      }).start();
    }
  }, [markerLat, markerLng, markerOnline, isDemoMode]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchActiveRequest();
    setRefreshing(false);
  };

  // Cancelar la solicitud activa desde Inicio (confirmacion simple; el flujo con
  // motivo detallado vive en Historial). Usa el RPC cancel_service_request.
  const [cancelling, setCancelling] = useState(false);
  const canCancel = activeRequest &&
    ['initiated', 'assigned', 'en_route'].includes(activeRequest.status);

  // Llamada directa al operador (tel:). El teléfono viene del perfil del
  // operador asignado. Util en carretera cuando el chat no basta.
  const callOperator = () => {
    if (activeRequest?.operator_phone) {
      Linking.openURL(`tel:${activeRequest.operator_phone}`);
    } else {
      Alert.alert('Sin teléfono', 'El operador no tiene un teléfono registrado.');
    }
  };

  const handleCancelActiveRequest = () => {
    if (!activeRequest) return;
    Alert.alert(
      'Cancelar solicitud',
      cancellationPolicyMessage(activeRequest.status),
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Si, cancelar',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            const { data, error } = await supabase.rpc('cancel_service_request', {
              p_request_id: activeRequest.id,
              p_reason: 'Cancelada por el usuario',
            });
            setCancelling(false);
            if (error || (data && !data.success)) {
              Alert.alert('Error', friendlyError(error, 'No se pudo cancelar la solicitud.'));
              return;
            }
            await fetchActiveRequest();
          },
        },
      ]
    );
  };

  // Render map content (shared between inline and fullscreen)
  const renderMapContent = (fullscreen: boolean) => {
    if (!MapView || !Marker || !activeRequest) return null;

    const OperatorMarkerComponent = MarkerAnimated && animatedCoordinate.current ? MarkerAnimated : Marker;
    const operatorCoordinate = animatedCoordinate.current && MarkerAnimated
      ? animatedCoordinate.current
      : effectiveOperatorPosition ?? null;

    // hasRealRoute comes from useTrackingRoute
    const isFallback = isDemoMode ? false : (hasRealRoute ? false : (eta?.isFallback ?? true));
    const hasDropoff = activeRequest.dropoff_lat && activeRequest.dropoff_lng;
    const showOperatorMarker = isDemoMode
      ? (simulator.currentPosition !== null)
      : (operatorLocation && operatorLocation.is_online);
    const operatorHeading = isDemoMode ? simulator.heading : (operatorLocation?.heading ?? 0);

    return (
      <MapView
        ref={mapRef}
        style={fullscreen ? styles.mapFullscreen : { width: '100%', height: MAP_HEIGHT }}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        mapType={USE_OSM ? 'none' : 'standard'}
        initialRegion={{
          latitude: activeRequest.pickup_lat,
          longitude: activeRequest.pickup_lng,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {/* OSM tiles cuando TILE_SOURCE === 'osm' (gratis, sin Google) */}
        {USE_OSM && UrlTile && (
          <UrlTile
            urlTemplate={MAP_CONFIG.OSM_TILE_URL}
            maximumZ={MAP_CONFIG.OSM_MAX_ZOOM}
            flipY={false}
          />
        )}

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
        {showOperatorMarker && operatorCoordinate && (
          <OperatorMarkerComponent
            coordinate={operatorCoordinate}
            title="Tu grua"
            description={activeRequest.operator_name || 'Operador'}
            anchor={{ x: 0.5, y: 0.5 }}
            flat={true}
            rotation={operatorHeading}
          >
            <View style={styles.truckMarker}>
              <Truck size={20} color={colors.primary[600]} strokeWidth={2.5} />
            </View>
          </OperatorMarkerComponent>
        )}

        {/* Route Polyline */}
        {Polyline && routeCoordinatesForMap.length >= 2 && (
          <Polyline
            coordinates={routeCoordinatesForMap}
            strokeColor={colors.primary[500]}
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
    return <LoadingSpinner fullScreen />;
  }

  if (activeRequestError) {
    return (
      <ErrorState
        fullScreen
        offline
        title="No pudimos cargar tu servicio"
        message="Revisa tu conexión a internet e intenta de nuevo."
        onRetry={fetchActiveRequest}
      />
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.l }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <BudiLogo variant="wordmark" height={28} />
        </View>
        <Text style={styles.greeting}>Hola{userName ? `, ${userName}` : ''}</Text>
        <Text style={styles.subtitle}>
          {activeRequest ? 'Tienes una solicitud activa' : 'Necesitas ayuda?'}
        </Text>
      </View>

      {activeRequest ? (
        // Active Request View
        <View style={styles.activeRequestContainer}>
          <StatusBadge status={activeRequest.status as ServiceRequestStatus} />

          {/* Aviso: la búsqueda de operador esta tardando mas de lo normal */}
          {searchDelayed && (
            <View style={styles.delayCard}>
              <Clock size={18} color={colors.warning.dark} />
              <Text style={styles.delayText}>
                La búsqueda esta tardando mas de lo normal. Seguimos buscando un
                operador disponible; puedes cancelar sin costo si lo prefieres.
              </Text>
            </View>
          )}

          {/* PIN de activacion - visible hasta que el operador lo verifique */}
          {showPin && activePin && (
            <View style={styles.pinCard}>
              <Text style={styles.pinLabel}>PIN para el operador</Text>
              <Text style={styles.pinValue}>{activePin}</Text>
              <Pressable
                style={styles.pinCopyBtn}
                onPress={() => copyPin(activePin)}
                accessibilityRole="button"
                accessibilityLabel="Copiar PIN"
              >
                {pinCopied ? (
                  <CheckCircle2 size={15} color={colors.success.main} strokeWidth={2} />
                ) : (
                  <Copy size={15} color={colors.accent[600]} strokeWidth={2} />
                )}
                <Text style={[styles.pinCopyText, pinCopied && { color: colors.success.main }]}>
                  {pinCopied ? '¡Copiado!' : 'Copiar'}
                </Text>
              </Pressable>
              <Text style={styles.pinHint}>
                Muéstrale este PIN al operador cuando llegue para iniciar el servicio.
              </Text>
            </View>
          )}

          {/* Mini-mapa de recogida/destino cuando aun no hay seguimiento en vivo
              (ej. estado "iniciado"), para no mostrar solo coordenadas */}
          {!showTracking && !isDemoMode && activeRequest.pickup_lat && activeRequest.pickup_lng && (
            <MiniMap
              pickup={{ lat: activeRequest.pickup_lat, lng: activeRequest.pickup_lng }}
              dropoff={
                activeRequest.dropoff_lat && activeRequest.dropoff_lng
                  ? { lat: activeRequest.dropoff_lat, lng: activeRequest.dropoff_lng }
                  : null
              }
              height={170}
            />
          )}

          {/* Live Map Tracking - PROMINENT, outside Card (Native only) */}
          {(showTracking || isDemoMode) && MapView && Marker && (
            <View style={styles.mapSection}>
              <View style={styles.mapContainer}>
                {renderMapContent(false)}

                {/* Expand button */}
                <Pressable
                  style={styles.mapExpandButton}
                  onPress={() => setIsMapFullscreen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Ampliar mapa"
                >
                  <Maximize2 size={18} color={colors.text.primary} />
                </Pressable>
              </View>

              {(isDemoMode && simulator.currentPosition) || (operatorLocation && operatorLocation.is_online) ? (
                <View style={styles.trackingInfo}>
                  <MapPin size={14} color={colors.success.main} />
                  <Text style={styles.trackingText}>
                    {isDemoMode ? 'Simulacion en vivo' : 'Ubicación en vivo'}
                    {!isDemoMode && lastUpdated && ` • ${Math.round((Date.now() - lastUpdated.getTime()) / 1000)}s`}
                  </Text>
                </View>
              ) : (
                <View style={styles.trackingInfoOffline}>
                  <Text style={styles.trackingTextOffline}>
                    Esperando ubicación del operador...
                  </Text>
                </View>
              )}

              {/* ETA overlay on map */}
              {showETASection && (
                <View style={styles.etaContainer}>
                  {isDemoMode && eta ? (
                    <>
                      <Text style={styles.etaLabel}>{activePhase ? 'Tiempo estimado al destino' : 'Tiempo estimado de llegada'}</Text>
                      <Text style={styles.etaValue}>{eta.etaText}</Text>
                      <Text style={styles.etaDistance}>
                        {eta.distanceText} de distancia
                      </Text>
                    </>
                  ) : !operatorLocation || !operatorLocation.is_online ? (
                    <View style={styles.etaLoading}>
                      <ActivityIndicator size="small" color={colors.primary[400]} />
                      <Text style={styles.etaLoadingText}>Obteniendo ubicación del operador...</Text>
                    </View>
                  ) : etaLoading ? (
                    <View style={styles.etaLoading}>
                      <ActivityIndicator size="small" color={colors.primary[400]} />
                      <Text style={styles.etaLoadingText}>Calculando tiempo...</Text>
                    </View>
                  ) : eta ? (
                    <>
                      <Text style={styles.etaLabel}>{activePhase ? 'Tiempo estimado al destino' : 'Tiempo estimado de llegada'}</Text>
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

              {/* Demo mode progress bar */}
              {isDemoMode && simulator.progress > 0 && (
                <View style={styles.progressBarContainer}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${Math.min(simulator.progress * 100, 100)}%` },
                    ]}
                  />
                </View>
              )}
            </View>
          )}

          {/* Demo mode badge */}
          {isDemoMode && (
            <View style={styles.demoBadge}>
              <Text style={styles.demoBadgeText}>DEMO</Text>
            </View>
          )}

          {/* Fullscreen Map Modal */}
          {(showTracking || isDemoMode) && MapView && (
            <Modal
              visible={isMapFullscreen}
              animationType="slide"
              onRequestClose={() => setIsMapFullscreen(false)}
            >
              <View style={styles.mapContainerFullscreen}>
                {renderMapContent(true)}

                {/* Close button */}
                <Pressable
                  style={styles.mapCloseButton}
                  onPress={() => setIsMapFullscreen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar mapa"
                >
                  <X size={20} color={colors.text.primary} strokeWidth={2.5} />
                </Pressable>

                {/* Tracking info overlay */}
                <View style={styles.fullscreenTrackingOverlay}>
                  {(isDemoMode && simulator.currentPosition) || (operatorLocation && operatorLocation.is_online) ? (
                    <View style={styles.trackingInfo}>
                      <MapPin size={14} color={colors.success.main} />
                      <Text style={styles.trackingText}>
                        {isDemoMode ? 'Simulacion en vivo' : 'Ubicación en vivo'}
                        {!isDemoMode && lastUpdated && ` • ${Math.round((Date.now() - lastUpdated.getTime()) / 1000)}s`}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.trackingInfoOffline}>
                      <Text style={styles.trackingTextOffline}>
                        Esperando ubicación del operador...
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

          {/* Fallback when MapView unavailable (web or native load error) */}
          {(showTracking || isDemoMode) && !MapView && (
            <View style={styles.webTrackingContainer}>
              <Text style={styles.webTrackingTitle}>Seguimiento en tiempo real</Text>
              {mapsLoadError && Platform.OS !== 'web' && (
                <Text style={styles.trackingTextOffline}>
                  Mapa no disponible: {mapsLoadError}
                </Text>
              )}
              {operatorLocation && operatorLocation.is_online ? (
                <View style={styles.trackingInfo}>
                  <MapPin size={14} color={colors.success.main} />
                  <Text style={styles.trackingText}>
                    Operador en linea
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
              {/* ETA for web/fallback */}
              {showETASection && eta && (
                <View style={styles.etaContainerWeb}>
                  <Text style={styles.etaLabel}>Tiempo estimado</Text>
                  <Text style={styles.etaValue}>{eta.etaText}</Text>
                </View>
              )}
            </View>
          )}

          {/* ETA when no map (status assigned/en_route but MapView unavailable) */}
          {showETASection && !showTracking && !isDemoMode && (
            <View style={styles.etaContainer}>
              {!operatorLocation || !operatorLocation.is_online ? (
                <View style={styles.etaLoading}>
                  <ActivityIndicator size="small" color={colors.primary[400]} />
                  <Text style={styles.etaLoadingText}>Obteniendo ubicación del operador...</Text>
                </View>
              ) : eta ? (
                <>
                  <Text style={styles.etaLabel}>Tiempo estimado de llegada</Text>
                  <Text style={styles.etaValue}>{eta.etaText}</Text>
                </>
              ) : null}
            </View>
          )}

          {/* Request Details Card */}
          <Card variant="elevated" padding="l">
            <View style={styles.requestDetails}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Tipo de Incidente</Text>
                <Text style={styles.detailValue}>{activeRequest.incident_type}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Tipo de Servicio</Text>
                <View style={styles.serviceTypeRow}>
                  {(() => {
                    const svcType = (activeRequest.service_type || 'tow') as ServiceType;
                    const cfg = SERVICE_TYPE_CONFIGS[svcType];
                    const isTow = !activeRequest.service_type || activeRequest.service_type === 'tow';
                    const SvcIcon = SERVICE_ICONS[svcType] || Truck;
                    return (
                      <>
                        <SvcIcon size={16} color={cfg?.color || colors.primary[500]} strokeWidth={2} />
                        <Text style={styles.detailValue}>
                          {cfg?.name || 'Grua'}{isTow ? ` - ${activeRequest.tow_type === 'light' ? 'Liviana' : 'Pesada'}` : ''}
                        </Text>
                      </>
                    );
                  })()}
                </View>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Recogida</Text>
                <AddressText
                  style={styles.detailValue}
                  numberOfLines={2}
                  address={activeRequest.pickup_address}
                  lat={activeRequest.pickup_lat}
                  lng={activeRequest.pickup_lng}
                />
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Destino</Text>
                <AddressText
                  style={styles.detailValue}
                  numberOfLines={2}
                  address={activeRequest.dropoff_address}
                  lat={activeRequest.dropoff_lat}
                  lng={activeRequest.dropoff_lng}
                />
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

              {/* Contacto con el operador (chat + llamada) cuando esta asignado */}
              {activeRequest.operator_id && ['assigned', 'en_route', 'active'].includes(activeRequest.status) && (
                <View style={styles.contactRow}>
                  <View style={styles.contactBtn}>
                    <Button
                      title="Chat"
                      onPress={() => setShowChat(true)}
                      variant="secondary"
                      size="medium"
                      icon={<MessageCircle size={18} color={colors.primary[500]} />}
                    />
                  </View>
                  <View style={styles.contactBtn}>
                    <Button
                      title="Llamar"
                      onPress={callOperator}
                      variant="secondary"
                      size="medium"
                      icon={<Phone size={18} color={colors.primary[500]} />}
                    />
                  </View>
                </View>
              )}

              {activeRequest.total_price && (
                <View style={styles.priceSection}>
                  <Text style={styles.priceLabel}>Precio Estimado</Text>
                  <Text style={styles.priceValue}>${activeRequest.total_price.toFixed(2)}</Text>
                </View>
              )}

              {canCancel && (
                <Button
                  title="Cancelar Solicitud"
                  onPress={handleCancelActiveRequest}
                  variant="tertiary"
                  size="medium"
                  loading={cancelling}
                  disabled={cancelling}
                  icon={<X size={18} color={colors.error.main} />}
                />
              )}
            </View>

            <View style={styles.requestIdRow}>
              <Text style={styles.requestIdText}>ID: {activeRequest.id.substring(0, 8)}</Text>
            </View>
          </Card>
        </View>
      ) : (
        // No Active Request - Show CTA
        <View style={styles.ctaContainer}>
          <Card variant="elevated" padding="xl">
            <View style={styles.ctaContent}>
              <View style={styles.ctaIconCircle}>
                <Truck size={48} color={colors.accent[500]} strokeWidth={1.8} />
              </View>
              <Text style={styles.ctaTitle}>Solicitar Servicio</Text>
              <Text style={styles.ctaDescription}>
                Estamos listos para ayudarte las 24 horas del dia, los 7 dias de la semana.
              </Text>
              <Button
                title="Solicitar Ahora"
                onPress={() => router.push('/(user)/request')}
              />
            </View>
          </Card>

          <View style={styles.infoCards}>
            <Card padding="m">
              <View style={styles.infoCardContent}>
                <Clock size={24} color={colors.primary[500]} strokeWidth={2} />
                <Text style={styles.infoTitle}>Rapido</Text>
                <Text style={styles.infoText}>Respuesta en minutos</Text>
              </View>
            </Card>
            <Card padding="m">
              <View style={styles.infoCardContent}>
                <DollarSign size={24} color={colors.accent[500]} strokeWidth={2} />
                <Text style={styles.infoTitle}>Precios Justos</Text>
                <Text style={styles.infoText}>Sin sorpresas</Text>
              </View>
            </Card>
          </View>

          {/* Pending Ratings Section */}
          {pendingRatings.length > 0 && (
            <View style={styles.pendingRatingsSection}>
              <Text style={styles.pendingRatingsTitle}>Califica tus servicios</Text>
              <Text style={styles.pendingRatingsSubtitle}>
                Tienes {pendingRatings.length} servicio{pendingRatings.length > 1 ? 's' : ''} sin calificar
              </Text>
              {pendingRatings.map((item) => (
                <Pressable
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
                    <Star size={16} color={colors.accent[500]} fill={colors.accent[500]} />
                    <Text style={styles.pendingRatingStarsText}>Calificar</Text>
                  </View>
                </Pressable>
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
  // Layout
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
  },
  content: {
    padding: spacing.l,
    paddingBottom: spacing.xxxxl,
  },

  // Header
  header: {
    marginBottom: spacing.xl,
  },
  logoContainer: {
    marginBottom: spacing.s,
  },
  greeting: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h1,
    color: colors.text.primary,
  },
  subtitle: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    marginTop: spacing.micro,
  },

  // Active request layout
  activeRequestContainer: {
    gap: spacing.m,
  },
  contactRow: {
    flexDirection: 'row',
    gap: spacing.s,
  },
  contactBtn: {
    flex: 1,
  },

  // Map section - prominent, full width
  mapSection: {
    borderRadius: radii.l,
    overflow: 'hidden',
    backgroundColor: colors.border.light,
  },

  // PIN de activacion
  delayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    padding: spacing.m,
    backgroundColor: colors.warning.light,
    borderRadius: radii.m,
    borderWidth: 1,
    borderColor: colors.warning.main,
  },
  delayText: {
    flex: 1,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.warning.dark,
  },
  pinCard: {
    alignItems: 'center',
    padding: spacing.l,
    backgroundColor: colors.accent[50],
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colors.accent[500],
  },
  pinLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.accent[600],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pinValue: {
    fontFamily: typography.fonts.heading,
    fontSize: 44,
    letterSpacing: 8,
    color: colors.accent[600],
    marginVertical: spacing.xs,
  },
  pinCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.m,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.accent[500],
    marginBottom: spacing.s,
  },
  pinCopyText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.caption,
    color: colors.accent[600],
  },
  pinHint: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    textAlign: 'center',
  },

  // Request details
  requestDetails: {
    gap: spacing.m,
  },
  detailRow: {
    gap: spacing.micro,
  },
  detailLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
  detailValue: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
  },
  serviceTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },

  // Operator
  operatorSection: {
    marginTop: spacing.xs,
    padding: spacing.s,
    backgroundColor: colors.success.light,
    borderRadius: radii.s,
  },
  operatorLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.success.dark,
  },
  operatorName: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
    marginTop: spacing.micro,
  },
  providerName: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginTop: 2,
  },

  // Chat icon removed - using Lucide MessageCircle

  // Price
  priceSection: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceLabel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
  },
  priceValue: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
    color: colors.text.primary,
  },

  // Request ID
  requestIdRow: {
    marginTop: spacing.m,
    paddingTop: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.border.light,
  },
  requestIdText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
  },

  // Map
  mapContainer: {
    height: MAP_HEIGHT,
    backgroundColor: colors.border.light,
  },
  mapFullscreen: {
    flex: 1,
  },
  mapContainerFullscreen: {
    flex: 1,
    backgroundColor: colors.black,
  },
  mapExpandButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
    zIndex: 10,
  },
  // mapExpandIcon removed - using Lucide Maximize2
  mapCloseButton: {
    position: 'absolute',
    top: 50,
    right: spacing.m,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 10,
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
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.m,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
  },
  fullscreenEtaText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.primary[800],
  },

  // Truck marker
  truckMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.primary[500],
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Demo mode
  demoBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent[500],
    paddingVertical: 2,
    paddingHorizontal: spacing.s,
    borderRadius: radii.s,
  },
  demoBadgeText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.micro,
    color: colors.white,
    letterSpacing: 1,
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: colors.primary[100],
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.accent[500],
    borderRadius: 2,
  },

  // Tracking info
  trackingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xs,
    backgroundColor: colors.success.light,
    gap: spacing.xs,
  },
  // trackingDot removed - using Lucide MapPin
  trackingText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.success.dark,
  },
  trackingInfoOffline: {
    padding: spacing.xs,
    backgroundColor: colors.warning.light,
    alignItems: 'center',
  },
  trackingTextOffline: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.warning.dark,
  },

  // Web tracking
  webTrackingContainer: {
    marginTop: spacing.m,
    padding: spacing.m,
    backgroundColor: colors.info.light,
    borderRadius: radii.m,
    borderWidth: 1,
    borderColor: colors.info.main,
  },
  webTrackingTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.info.dark,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },

  // ETA
  etaContainer: {
    marginTop: spacing.m,
    padding: spacing.m,
    backgroundColor: colors.primary[50],
    borderRadius: radii.m,
    borderWidth: 1,
    borderColor: colors.primary[100],
    alignItems: 'center',
  },
  etaLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  etaLoadingText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.primary[400],
  },
  etaLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.primary[500],
    marginBottom: spacing.micro,
  },
  etaValue: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h1,
    color: colors.primary[800],
  },
  etaDistance: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.primary[400],
    marginTop: spacing.micro,
  },
  etaContainerWeb: {
    marginTop: spacing.s,
    paddingTop: spacing.s,
    borderTopWidth: 1,
    borderTopColor: colors.info.main,
    alignItems: 'center',
  },

  // CTA (no active request)
  ctaContainer: {
    gap: spacing.m,
  },
  ctaContent: {
    alignItems: 'center',
    paddingVertical: spacing.m,
  },
  ctaIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.accent[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.m,
  },
  ctaTitle: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  ctaDescription: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.l,
    lineHeight: typography.lineHeights.bodySmall,
  },

  // Info cards
  infoCards: {
    flexDirection: 'row',
    gap: spacing.s,
  },
  infoCardContent: {
    flex: 1,
    alignItems: 'center',
  },
  infoTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
    marginBottom: spacing.micro,
  },
  infoText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    textAlign: 'center',
  },

  // Pending ratings
  pendingRatingsSection: {
    marginTop: spacing.xl,
    padding: spacing.m,
    backgroundColor: colors.warning.light,
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colors.warning.main,
  },
  pendingRatingsTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.h4,
    color: colors.warning.dark,
    marginBottom: spacing.micro,
  },
  pendingRatingsSubtitle: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.warning.dark,
    marginBottom: spacing.s,
  },
  pendingRatingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background.primary,
    padding: spacing.s,
    borderRadius: radii.m,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.warning.main,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent[500],
  },
  pendingRatingInfo: {
    flex: 1,
  },
  pendingRatingOperator: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
  },
  pendingRatingDate: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginTop: 2,
  },
  pendingRatingStars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.micro,
    backgroundColor: colors.accent[50],
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.s,
    borderRadius: radii.full,
  },
  pendingRatingStarsText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.accent[600],
  },
});
