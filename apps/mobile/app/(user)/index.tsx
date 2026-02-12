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
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useOperatorRealtimeTracking } from '@/hooks/useOperatorRealtimeTracking';
import { useETA } from '@/hooks/useETA';
import { useGPSSimulator } from '@/hooks/useGPSSimulator';
import { RatingModal } from '@/components/RatingModal';
import { ChatScreen } from '@/components/ChatScreen';
import { decodePolyline } from '@/lib/geoUtils';
import type { LatLng } from '@/lib/geoUtils';
import { DEMO_CONFIG } from '@/config/demo';
import { SERVICE_TYPE_CONFIGS } from '@gruas-app/shared';
import type { ServiceRequestStatus, ServiceType } from '@gruas-app/shared';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Star, MessageCircle, MapPin, Maximize2, Truck, X, Clock, DollarSign } from 'lucide-react-native';
import { SERVICE_ICONS } from '@/lib/serviceIcons';
import { BudiLogo, Button, Card, StatusBadge, LoadingSpinner } from '@/components/ui';
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AnimatedRegion: (new (...args: unknown[]) => { timing: (config: Record<string, unknown>) => { start: () => void } }) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PROVIDER_GOOGLE: any = null;
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
  } catch (e) {
    mapsLoadError = e instanceof Error ? e.message : 'Failed to load react-native-maps';
    console.error('[Maps] Failed to load react-native-maps:', e);
  }
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
  service_type: string;
  route_polyline: string | null;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.4);
const EDGE_PADDING = { top: 60, right: 60, bottom: 60, left: 60 };

export default function UserHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  // Debug: log map rendering conditions when active request exists
  useEffect(() => {
    if (activeRequest) {
      console.log('=== MAP TRACKING DEBUG ===');
      console.log('Status:', activeRequest.status);
      console.log('Operator ID:', operatorId);
      console.log('showTracking:', !!showTracking);
      console.log('MapView loaded:', !!MapView);
      console.log('Marker loaded:', !!Marker);
      console.log('Maps load error:', mapsLoadError);
      console.log('Platform:', Platform.OS);
    }
  }, [activeRequest?.status, operatorId, showTracking]);

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

  const pickupLocation = useMemo(() =>
    activeRequest ? { lat: activeRequest.pickup_lat, lng: activeRequest.pickup_lng } : null,
    [activeRequest?.pickup_lat, activeRequest?.pickup_lng]
  );

  const operatorCoords = useMemo(() =>
    operatorLocation ? { lat: operatorLocation.lat, lng: operatorLocation.lng } : null,
    [operatorLocation?.lat, operatorLocation?.lng]
  );

  const { eta: realEta, loading: etaLoading } = useETA(
    operatorCoords,
    pickupLocation,
    canCalculateETA || false
  );

  // --- Demo Mode: GPS Simulation ---
  // Demo mode activates when: config enabled + operator assigned + trackable status
  const isDemoMode = DEMO_CONFIG.ENABLED &&
    activeRequest !== null &&
    ['assigned', 'en_route'].includes(activeRequest.status) &&
    activeRequest.operator_id !== null;

  // Decode stored route polyline (saved when operator accepted)
  const storedRoutePolyline = activeRequest?.route_polyline;
  const decodedStoredRoute = useMemo(() =>
    storedRoutePolyline ? decodePolyline(storedRoutePolyline) : [],
    [storedRoutePolyline]
  );

  // Use ETA polyline as fallback if no stored route
  const etaPolyline = realEta?.overviewPolyline;
  const decodedEtaRoute = useMemo(() =>
    etaPolyline ? decodePolyline(etaPolyline) : [],
    [etaPolyline]
  );

  // Straight-line fallback: generate intermediate points from a nearby offset to pickup
  // Used when no real polyline is available (edge function down, no stored route)
  const straightLineFallback = useMemo(() => {
    if (!activeRequest) return [];
    const pickup = { latitude: activeRequest.pickup_lat, longitude: activeRequest.pickup_lng };
    // Offset ~2km south-west as simulated operator start position
    const simulatedStart = {
      latitude: pickup.latitude - 0.015,
      longitude: pickup.longitude - 0.012,
    };
    // Create intermediate waypoints for smoother simulation
    const steps = 20;
    const points: LatLng[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push({
        latitude: simulatedStart.latitude + (pickup.latitude - simulatedStart.latitude) * t,
        longitude: simulatedStart.longitude + (pickup.longitude - simulatedStart.longitude) * t,
      });
    }
    return points;
  }, [activeRequest?.pickup_lat, activeRequest?.pickup_lng]);

  // Pick best available route for simulation: stored polyline > ETA polyline > straight line
  const simulationRoute = useMemo(() => {
    if (decodedStoredRoute.length >= 2) return decodedStoredRoute;
    if (decodedEtaRoute.length >= 2) return decodedEtaRoute;
    if (isDemoMode && straightLineFallback.length >= 2) return straightLineFallback;
    return [];
  }, [decodedStoredRoute, decodedEtaRoute, isDemoMode, straightLineFallback]);

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
        overviewPolyline: storedRoutePolyline ?? null,
      })
    : realEta;

  // Compute route coordinates for map display (memoized, no setState needed)
  // Priority: demo simulation > stored DB polyline > ETA polyline > straight-line fallback
  const routeCoordinatesForMap = useMemo(() => {
    if (isDemoMode && simulationRoute.length >= 2) {
      return simulationRoute;
    }
    if (decodedStoredRoute.length >= 2) {
      return decodedStoredRoute;
    }
    if (decodedEtaRoute.length >= 2) {
      return decodedEtaRoute;
    }
    if (realEta?.overviewPolyline) {
      return decodePolyline(realEta.overviewPolyline);
    }
    if (operatorLocation && operatorLocation.is_online && activeRequest) {
      return [
        { latitude: operatorLocation.lat, longitude: operatorLocation.lng },
        { latitude: activeRequest.pickup_lat, longitude: activeRequest.pickup_lng },
      ];
    }
    return [];
  }, [isDemoMode, simulationRoute, decodedStoredRoute, decodedEtaRoute, realEta?.overviewPolyline, operatorLocation?.lat, operatorLocation?.lng, operatorLocation?.is_online, activeRequest?.pickup_lat, activeRequest?.pickup_lng]);

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

    // Get active requests - try with route_polyline first, fallback without it
    const baseSelect = `
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
      operator_id,
      service_type,
      operator:profiles!service_requests_operator_id_fkey (full_name),
      providers (name)
    `;

    let { data: requests, error: fetchError } = await supabase
      .from('service_requests')
      .select(`${baseSelect}, route_polyline`)
      .eq('user_id', user.id)
      .in('status', ['initiated', 'assigned', 'en_route', 'active'])
      .order('created_at', { ascending: false })
      .limit(1);

    // Fallback: if query failed (e.g. route_polyline column missing), retry without it
    if (fetchError) {
      console.warn('[UserHome] Query with route_polyline failed, retrying without:', fetchError.message);
      const fallback = await supabase
        .from('service_requests')
        .select(baseSelect)
        .eq('user_id', user.id)
        .in('status', ['initiated', 'assigned', 'en_route', 'active'])
        .order('created_at', { ascending: false })
        .limit(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      requests = fallback.data as typeof requests;
      fetchError = fallback.error;
    }

    if (fetchError) {
      console.error('[UserHome] Failed to fetch active requests:', fetchError.message);
    }

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
        operator_id: req.operator_id,
        operator_name: (req.operator as unknown as { full_name: string } | null)?.full_name || null,
        provider_name: (req.providers as unknown as { name: string } | null)?.name || null,
        service_type: req.service_type || 'tow',
        route_polyline: (req as Record<string, unknown>).route_polyline as string | null ?? null,
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
      : effectiveOperatorPosition ?? null;

    const hasRealRoute = decodedStoredRoute.length >= 2 || decodedEtaRoute.length >= 2;
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

          {/* Live Map Tracking - PROMINENT, outside Card (Native only) */}
          {(showTracking || isDemoMode) && MapView && Marker && (
            <View style={styles.mapSection}>
              <View style={styles.mapContainer}>
                {renderMapContent(false)}

                {/* Expand button */}
                <Pressable
                  style={styles.mapExpandButton}
                  onPress={() => setIsMapFullscreen(true)}
                >
                  <Maximize2 size={18} color={colors.text.primary} />
                </Pressable>
              </View>

              {(isDemoMode && simulator.currentPosition) || (operatorLocation && operatorLocation.is_online) ? (
                <View style={styles.trackingInfo}>
                  <MapPin size={14} color={colors.success.main} />
                  <Text style={styles.trackingText}>
                    {isDemoMode ? 'Simulacion en vivo' : 'Ubicacion en vivo'}
                    {!isDemoMode && lastUpdated && ` • ${Math.round((Date.now() - lastUpdated.getTime()) / 1000)}s`}
                  </Text>
                </View>
              ) : (
                <View style={styles.trackingInfoOffline}>
                  <Text style={styles.trackingTextOffline}>
                    Esperando ubicacion del operador...
                  </Text>
                </View>
              )}

              {/* ETA overlay on map */}
              {showETASection && (
                <View style={styles.etaContainer}>
                  {isDemoMode && eta ? (
                    <>
                      <Text style={styles.etaLabel}>Tiempo estimado de llegada</Text>
                      <Text style={styles.etaValue}>{eta.etaText}</Text>
                      <Text style={styles.etaDistance}>
                        {eta.distanceText} de distancia
                      </Text>
                    </>
                  ) : !operatorLocation || !operatorLocation.is_online ? (
                    <View style={styles.etaLoading}>
                      <ActivityIndicator size="small" color={colors.primary[400]} />
                      <Text style={styles.etaLoadingText}>Obteniendo ubicacion del operador...</Text>
                    </View>
                  ) : etaLoading ? (
                    <View style={styles.etaLoading}>
                      <ActivityIndicator size="small" color={colors.primary[400]} />
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
                >
                  <X size={20} color={colors.text.primary} strokeWidth={2.5} />
                </Pressable>

                {/* Tracking info overlay */}
                <View style={styles.fullscreenTrackingOverlay}>
                  {(isDemoMode && simulator.currentPosition) || (operatorLocation && operatorLocation.is_online) ? (
                    <View style={styles.trackingInfo}>
                      <MapPin size={14} color={colors.success.main} />
                      <Text style={styles.trackingText}>
                        {isDemoMode ? 'Simulacion en vivo' : 'Ubicacion en vivo'}
                        {!isDemoMode && lastUpdated && ` • ${Math.round((Date.now() - lastUpdated.getTime()) / 1000)}s`}
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
                    Esperando ubicacion del operador...
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
                  <Text style={styles.etaLoadingText}>Obteniendo ubicacion del operador...</Text>
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
                <Button
                  title="Chat con Operador"
                  onPress={() => setShowChat(true)}
                  variant="secondary"
                  size="medium"
                  icon={<MessageCircle size={18} color={colors.primary[500]} />}
                />
              )}

              {activeRequest.total_price && (
                <View style={styles.priceSection}>
                  <Text style={styles.priceLabel}>Precio Estimado</Text>
                  <Text style={styles.priceValue}>${activeRequest.total_price.toFixed(2)}</Text>
                </View>
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

  // Map section - prominent, full width
  mapSection: {
    borderRadius: radii.l,
    overflow: 'hidden',
    backgroundColor: colors.border.light,
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
