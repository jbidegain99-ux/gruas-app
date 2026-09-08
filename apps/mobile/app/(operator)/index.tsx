import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  RefreshControl,
  Alert,
  Image,
  Switch,
} from 'react-native';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { MapPin, Zap, ClipboardList, Truck, Navigation, Clock, PowerOff, Wallet } from 'lucide-react-native';
import { SERVICE_ICONS } from '@/lib/serviceIcons';
import { supabase } from '@/lib/supabase';
import { useOperatorLocationTracking } from '@/features/tracking/hooks/useOperatorLocationTracking';
import { haversineKm, estimateMinutes, formatKm } from '@/lib/distance';
import { fetchOperatorEarnings, money, EMPTY_EARNINGS, type EarningsSummary } from '@/lib/earnings';
import { osrmLegs } from '@/lib/osrm';
import { SERVICE_TYPE_CONFIGS } from '@gruas-app/shared';
import type { ServiceType } from '@gruas-app/shared';
import { BudiLogo, Button, Card, LoadingSpinner, ErrorState } from '@/shared/components/ui';
import { AddressText } from '@/shared/components/AddressText';
import { colors, typography, spacing, radii } from '@/theme';

type AvailableRequest = {
  id: string;
  tow_type: string;
  incident_type: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  created_at: string;
  user_name: string | null;
  user_phone: string | null;
  vehicle_photo_url: string | null;
  notes: string | null;
  service_type: string;
  service_details: Record<string, unknown>;
};

export default function OperatorRequests() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [requests, setRequests] = useState<AvailableRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState('');
  const [hasActiveService, setHasActiveService] = useState(false);
  const [operatorLoc, setOperatorLoc] = useState<{ lat: number; lng: number } | null>(null);
  // Disponibilidad: cuando está "en línea" transmite ubicación y recibe
  // solicitudes. Se persiste para recordar el estado entre sesiones.
  const [online, setOnline] = useState(false);
  const [onlineLoaded, setOnlineLoaded] = useState(false);
  const [verified, setVerified] = useState(true); // hasta cargar el perfil, no bloquear
  const [earnings, setEarnings] = useState<EarningsSummary>(EMPTY_EARNINGS);

  // Transmite ubicación cuando el operador está en línea, aprobado y sin
  // servicio activo (durante un servicio activo, la pantalla "Activo" ya transmite).
  useOperatorLocationTracking({ isActive: online && verified && !hasActiveService });
  // Distancias reales por carretera (OSRM) por solicitud. Mientras cargan, la
  // tarjeta muestra haversine (instantaneo) como respaldo.
  const [routeInfo, setRouteInfo] = useState<
    Record<string, { toPickupKm?: number; tripKm?: number; tripMin?: number }>
  >({});

  const fetchData = useCallback(async () => {
    setLoadError(false);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    // Get operator profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, provider_id, verification_status')
      .eq('id', user.id)
      .single();

    if (profile?.full_name) {
      setOperatorName(profile.full_name.split(' ')[0]);
    }
    setVerified(profile?.verification_status === 'approved');

    // Ganancias de hoy / esta semana (se muestran siempre, incluso con servicio activo)
    setEarnings(await fetchOperatorEarnings());

    // Check if operator has an active service
    const { data: activeServices } = await supabase
      .from('service_requests')
      .select('id')
      .eq('operator_id', user.id)
      .in('status', ['assigned', 'en_route', 'active'])
      .limit(1);

    setHasActiveService((activeServices?.length || 0) > 0);

    if ((activeServices?.length || 0) > 0) {
      setRequests([]);
      setLoading(false);
      return;
    }

    // Fetch available requests using RPC (uses auth.uid() internally)
    const { data: availableRequests, error: rpcError } = await supabase.rpc('get_available_requests_for_operator');

    if (rpcError) {
      console.error('Error fetching available requests:', rpcError);
      setLoadError(true);
    }

    if (availableRequests) {
      setRequests(availableRequests as AvailableRequest[]);
    }

    setLoading(false);
  }, []);

  // Refresca cada vez que se entra a la pestaña. El realtime es el camino
  // normal, pero si un evento se pierde (pasa) la pantalla se quedaba
  // congelada en "tienes un servicio activo" despues de completarlo, sin
  // forma de volver al pool salvo reiniciar la app. Volver aca la pone al dia.
  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  useEffect(() => {
    // Subscribe to real-time updates
    const channel = supabase
      .channel('operator-requests')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'service_requests',
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  // Ubicación del operador (best-effort) para mostrar "a X km de ti" en cada
  // solicitud. Si no hay permiso/GPS, simplemente no se muestra esa distancia.
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setOperatorLoc({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch {
        // sin ubicación; se omite la distancia al operador
      }
    })();
  }, []);

  // Ruta real (OSRM) por solicitud: una sola llamada por tarjeta con waypoints
  // operador->recogida->destino, que devuelve ambos tramos de una.
  const requestIdsKey = requests.map((r) => r.id).join(',');
  useEffect(() => {
    if (requests.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        requests.map(async (item) => {
          const isTow = !item.service_type || item.service_type === 'tow';
          const hasDropoff = isTow && !!item.dropoff_lat && !!item.dropoff_lng;
          const points: { lat: number; lng: number }[] = [];
          if (operatorLoc) points.push(operatorLoc);
          points.push({ lat: item.pickup_lat, lng: item.pickup_lng });
          if (hasDropoff) points.push({ lat: item.dropoff_lat, lng: item.dropoff_lng });

          const legs = points.length >= 2 ? await osrmLegs(points) : null;
          if (!legs) return null;

          const info: { toPickupKm?: number; tripKm?: number; tripMin?: number } = {};
          let idx = 0;
          if (operatorLoc && legs[idx]) {
            info.toPickupKm = legs[idx].km;
            idx++;
          }
          if (hasDropoff && legs[idx]) {
            info.tripKm = legs[idx].km;
            info.tripMin = legs[idx].min;
          }
          return { id: item.id, info };
        })
      );
      if (cancelled) return;
      setRouteInfo((prev) => {
        const next = { ...prev };
        for (const e of entries) if (e) next[e.id] = e.info;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [requestIdsKey, operatorLoc]);

  // Cargar el estado de disponibilidad guardado (una sola vez).
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem('operator_online');
        setOnline(saved === 'true');
      } catch {
        // ignora; queda fuera de línea por defecto
      } finally {
        setOnlineLoaded(true);
      }
    })();
  }, []);

  const toggleOnline = useCallback(async (value: boolean) => {
    setOnline(value);
    try {
      await AsyncStorage.setItem('operator_online', value ? 'true' : 'false');
    } catch {
      // no bloquear por fallo de persistencia
    }
    if (value) fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  // Confirmación antes de tomar el servicio: es la acción más crítica del flujo
  // y antes se ejecutaba al primer toque. Mostramos un resumen con lo que el
  // operador necesita para decidir (a dónde va, qué tan lejos, cuánto dura).
  const confirmAccept = (
    item: AvailableRequest,
    metrics: { toPickupKm: number | null; tripKm: number | null; tripMin: number | null }
  ) => {
    const svcConfig = SERVICE_TYPE_CONFIGS[(item.service_type || 'tow') as ServiceType];
    const lines: string[] = [];
    lines.push(`Servicio: ${svcConfig?.name || 'Grua'}`);
    if (item.user_name) lines.push(`Cliente: ${item.user_name}`);
    if (metrics.toPickupKm !== null) lines.push(`Recogida a ${formatKm(metrics.toPickupKm)} de ti`);
    if (metrics.tripKm !== null) lines.push(`Viaje: ${formatKm(metrics.tripKm)}${metrics.tripMin !== null ? ` (~${metrics.tripMin} min)` : ''}`);

    Alert.alert(
      '¿Aceptar este servicio?',
      lines.join('\n'),
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Aceptar', onPress: () => handleAcceptRequest(item.id) },
      ]
    );
  };

  const handleAcceptRequest = async (requestId: string) => {
    setAcceptingId(requestId);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      Alert.alert('Error', 'Debes iniciar sesión');
      setAcceptingId(null);
      return;
    }

    // Tomar la solicitud vía RPC `accept_service_request` (SECURITY DEFINER):
    // salta RLS y hace el UPDATE con guarda anti doble-toma
    // (status='initiated' AND operator_id IS NULL). Un UPDATE directo NO
    // funciona: la politica RLS del operador exige operator_id = auth.uid(),
    // que aun es NULL, asi que afectaria 0 filas sin devolver error.
    const { error } = await supabase.rpc('accept_service_request', {
      p_request_id: requestId,
    });

    if (error) {
      Alert.alert('Error', 'No se pudo aceptar la solicitud. Puede que ya haya sido tomada.');
      setAcceptingId(null);
      await fetchData();
      return;
    }

    // Note: Audit event is logged automatically by DB trigger on status change

    // Fetch route polyline from operator location to pickup (non-blocking)
    fetchAndSaveRoutePolyline(requestId).catch((err) =>
      console.warn('[Route] Failed to save polyline (non-critical):', err)
    );

    Alert.alert('Solicitud Aceptada', 'Has aceptado el servicio. Dirigete al lugar de recogida.', [
      {
        text: 'Ver Servicio',
        onPress: () => router.push('/(operator)/active'),
      },
    ]);

    setAcceptingId(null);
    await fetchData();
  };

  /**
   * Fetch route directions from operator's current location to the request pickup,
   * then save the encoded polyline to service_requests for demo mode simulation.
   */
  const fetchAndSaveRoutePolyline = async (requestId: string) => {
    // Get operator's current location
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    // Find the request to get pickup coordinates
    const request = requests.find((r) => r.id === requestId);
    if (!request) return;

    // Fetch route via get-eta edge function (returns polyline)
    const { data, error: fnError } = await supabase.functions.invoke('get-eta', {
      body: {
        request_id: requestId,
        operator_lat: location.coords.latitude,
        operator_lng: location.coords.longitude,
        destination_lat: request.pickup_lat,
        destination_lng: request.pickup_lng,
      },
    });

    if (fnError || !data?.success || !data?.overview_polyline) {
      console.warn('[Route] Edge function did not return polyline');
      return;
    }

    // Save polyline to service_requests
    const { error: updateError } = await supabase
      .from('service_requests')
      .update({ route_polyline: data.overview_polyline })
      .eq('id', requestId);

    if (updateError) {
      console.warn('[Route] Failed to save polyline:', updateError.message);
    } else {
      console.log('[Route] Polyline saved for request', requestId);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);

    if (diffMinutes < 1) return 'Ahora';
    if (diffMinutes < 60) return `Hace ${diffMinutes} min`;

    return date.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
  };

  const renderRequest = ({ item }: { item: AvailableRequest }) => {
    const svcConfig = SERVICE_TYPE_CONFIGS[(item.service_type || 'tow') as ServiceType];
    const isTow = !item.service_type || item.service_type === 'tow';

    // Preferimos ruta real (OSRM); mientras carga usamos haversine (instantaneo).
    const info = routeInfo[item.id];
    const hasTrip = isTow && item.dropoff_lat && item.dropoff_lng;
    const tripKm =
      info?.tripKm ??
      (hasTrip ? haversineKm(item.pickup_lat, item.pickup_lng, item.dropoff_lat, item.dropoff_lng) : null);
    const tripMin = info?.tripMin ?? (tripKm !== null ? estimateMinutes(tripKm) : null);
    const toPickupKm =
      info?.toPickupKm ??
      (operatorLoc ? haversineKm(operatorLoc.lat, operatorLoc.lng, item.pickup_lat, item.pickup_lng) : null);

    return (
      <Card variant="elevated" padding="m">
        <View style={styles.requestHeader}>
          <View style={[styles.towTypeBadge, { backgroundColor: `${svcConfig?.color || colors.accent[500]}15` }]}>
            {(() => {
              const SvcIcon = SERVICE_ICONS[(item.service_type || 'tow') as ServiceType] || Truck;
              return <SvcIcon size={14} color={svcConfig?.color || colors.accent[500]} strokeWidth={2} />;
            })()}
            <Text style={[styles.towTypeText, { color: svcConfig?.color || colors.accent[500] }]}>
              {svcConfig?.name || 'Grua'}
              {isTow && ` - ${item.tow_type === 'light' ? 'Liviana' : 'Pesada'}`}
            </Text>
          </View>
          <Text style={styles.timeText}>{formatTime(item.created_at)}</Text>
        </View>

        <Text style={styles.incidentType}>{item.incident_type}</Text>

        <View style={styles.addressSection}>
          <View style={styles.addressRow}>
            <MapPin size={14} color={colors.success.main} strokeWidth={2} />
            <View style={styles.addressTextContainer}>
              <Text style={styles.addressLabel}>Recogida</Text>
              <AddressText
                style={styles.addressText}
                numberOfLines={2}
                address={item.pickup_address}
                lat={item.pickup_lat}
                lng={item.pickup_lng}
              />
            </View>
          </View>
          {isTow && (
            <>
              <View style={styles.addressLine} />
              <View style={styles.addressRow}>
                <MapPin size={14} color={colors.error.main} strokeWidth={2} />
                <View style={styles.addressTextContainer}>
                  <Text style={styles.addressLabel}>Destino</Text>
                  <AddressText
                    style={styles.addressText}
                    numberOfLines={2}
                    address={item.dropoff_address}
                    lat={item.dropoff_lat}
                    lng={item.dropoff_lng}
                  />
                </View>
              </View>
            </>
          )}
          {!isTow && (
            <Text style={styles.pickupOnlyText}>Solo recogida</Text>
          )}
        </View>

        {/* Metricas: a que distancia esta el operador y tamano del viaje */}
        {(toPickupKm !== null || tripKm !== null) && (
          <View style={styles.metricsRow}>
            {toPickupKm !== null && (
              <View style={styles.metric}>
                <Navigation size={14} color={colors.accent[500]} strokeWidth={2} />
                <Text style={styles.metricText}>
                  A {formatKm(toPickupKm)} de ti
                </Text>
              </View>
            )}
            {tripKm !== null && (
              <View style={styles.metric}>
                <Truck size={14} color={colors.text.secondary} strokeWidth={2} />
                <Text style={styles.metricText}>Viaje {formatKm(tripKm)}</Text>
              </View>
            )}
            {tripMin !== null && (
              <View style={styles.metric}>
                <Clock size={14} color={colors.text.secondary} strokeWidth={2} />
                <Text style={styles.metricText}>~{tripMin} min</Text>
              </View>
            )}
          </View>
        )}

        {item.user_name && (
          <Text style={styles.userName}>Cliente: {item.user_name}</Text>
        )}

        {/* Vehicle Photo */}
        {item.vehicle_photo_url && (
          <View style={styles.photoContainer}>
            <Image
              source={{ uri: item.vehicle_photo_url }}
              style={styles.vehiclePhoto}
              resizeMode="cover"
            />
          </View>
        )}

        {/* Notes */}
        {item.notes && (
          <Text style={styles.notesText} numberOfLines={2}>{item.notes}</Text>
        )}

        <Button
          title="Aceptar Servicio"
          onPress={() => confirmAccept(item, { toPickupKm, tripKm, tripMin })}
          loading={acceptingId === item.id}
          disabled={acceptingId === item.id}
          size="large"
        />
      </Card>
    );
  };

  if (loading) {
    return <LoadingSpinner fullScreen />;
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.l }]}>
        <BudiLogo variant="wordmark" height={28} />
        <Text style={styles.greeting}>Hola{operatorName ? `, ${operatorName}` : ''}</Text>
        <Text style={styles.subtitle}>
          {hasActiveService
            ? 'Tienes un servicio activo'
            : !online
              ? 'Estás fuera de línea'
              : requests.length > 0
                ? `${requests.length} solicitud${requests.length !== 1 ? 'es' : ''} disponible${requests.length !== 1 ? 's' : ''}`
                : 'No hay solicitudes disponibles'}
        </Text>

        {/* Ganancias del periodo */}
        <View style={styles.earningsCard}>
          <View style={styles.earningsBlock}>
            <View style={styles.earningsLabelRow}>
              <Wallet size={13} color={colors.text.tertiary} strokeWidth={2} />
              <Text style={styles.earningsLabel}>Cobras hoy</Text>
            </View>
            <Text style={styles.earningsAmount}>{money(earnings.hoy.aCobrar)}</Text>
            <Text style={styles.earningsCount}>
              {earnings.hoy.servicios} servicio{earnings.hoy.servicios === 1 ? '' : 's'}
            </Text>
          </View>
          <View style={styles.earningsDivider} />
          <View style={styles.earningsBlock}>
            <Text style={styles.earningsLabel}>Cobras esta semana</Text>
            <Text style={styles.earningsAmount}>{money(earnings.semana.aCobrar)}</Text>
            <Text style={styles.earningsCount}>
              {earnings.semana.servicios} servicio{earnings.semana.servicios === 1 ? '' : 's'}
            </Text>
          </View>
        </View>
        {/* De donde sale el neto: sin esto el operador ve una cifra menor que la
            que le cobro al cliente y no tiene como cuadrarla. */}
        {earnings.semana.bruto > 0 && (
          <Text style={styles.earningsNote}>
            Facturado esta semana {money(earnings.semana.bruto)} · Budi retiene{' '}
            {earnings.semana.comisionPct}% ({money(earnings.semana.comision)})
          </Text>
        )}

        {/* Cuenta en revisión: aún no aprobado por un administrador */}
        {!hasActiveService && !verified && (
          <View style={[styles.availabilityRow, styles.availabilityOff]}>
            <View style={[styles.statusDot, { backgroundColor: colors.warning.main }]} />
            <Text style={[styles.availabilityText, { color: colors.warning.dark }]}>
              Cuenta en revisión
            </Text>
          </View>
        )}

        {/* Toggle de disponibilidad (oculto durante un servicio activo o sin aprobar) */}
        {!hasActiveService && verified && (
          <View style={[styles.availabilityRow, online ? styles.availabilityOn : styles.availabilityOff]}>
            <View style={[styles.statusDot, { backgroundColor: online ? colors.success.main : colors.text.tertiary }]} />
            <Text style={[styles.availabilityText, { color: online ? colors.success.dark : colors.text.secondary }]}>
              {online ? 'En línea' : 'Fuera de línea'}
            </Text>
            <Switch
              value={online}
              onValueChange={toggleOnline}
              disabled={!onlineLoaded}
              trackColor={{ true: colors.success.light, false: colors.border.medium }}
              thumbColor={online ? colors.success.main : colors.background.primary}
            />
          </View>
        )}
      </View>

      {hasActiveService ? (
        // Va en ScrollView y no en View para que este estado tambien tenga
        // pull-to-refresh: es justo donde el operador se queda esperando, y sin
        // el quedaba encerrado si se perdia el evento de realtime del cierre.
        <ScrollView
          contentContainerStyle={[styles.pullable, styles.activeServiceWrapper]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent[500]} />
          }
        >
          <Card variant="outlined" padding="l">
            <View style={styles.activeServiceContent}>
              <Zap size={32} color={colors.accent[500]} strokeWidth={2} />
              <Text style={styles.activeServiceText}>
                Tienes un servicio en curso. Complétalo antes de aceptar uno nuevo.
              </Text>
              <Button
                title="Ver Servicio Activo"
                onPress={() => router.push('/(operator)/active')}
                size="large"
              />
            </View>
          </Card>
        </ScrollView>
      ) : !verified ? (
        <ScrollView
          contentContainerStyle={[styles.pullable, styles.emptyState]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent[500]} />
          }
        >
          <ClipboardList size={56} color={colors.warning.main} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>Verificación pendiente</Text>
          <Text style={styles.emptyText}>
            Necesitas verificar tu cuenta antes de recibir solicitudes. Sube tus
            documentos y un administrador los revisará.
          </Text>
          <View style={styles.emptyAction}>
            <Button
              title="Completar verificación"
              onPress={() => router.push('/(operator)/verification' as Href)}
              size="medium"
            />
          </View>
        </ScrollView>
      ) : !online ? (
        <View style={styles.emptyState}>
          <PowerOff size={56} color={colors.text.tertiary} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>Fuera de línea</Text>
          <Text style={styles.emptyText}>
            Ponte en línea para recibir solicitudes y que los clientes vean tu ubicación.
          </Text>
        </View>
      ) : loadError ? (
        <ErrorState
          offline
          title="No pudimos cargar las solicitudes"
          message="Revisa tu conexión e intenta de nuevo."
          onRetry={onRefresh}
        />
      ) : requests.length === 0 ? (
        <ScrollView
          contentContainerStyle={[styles.pullable, styles.emptyState]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent[500]} />
          }
        >
          <ClipboardList size={56} color={colors.text.tertiary} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>Sin solicitudes</Text>
          <Text style={styles.emptyText}>
            Las nuevas solicitudes aparecerán aquí automáticamente.
          </Text>
        </ScrollView>
      ) : (
        <FlatList
          data={requests}
          renderItem={renderRequest}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent[500]} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
  },
  header: {
    padding: spacing.l,
    paddingBottom: spacing.s,
    backgroundColor: colors.background.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  greeting: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h1,
    color: colors.text.primary,
    marginTop: spacing.s,
  },
  subtitle: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    marginTop: spacing.micro,
  },
  earningsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.m,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.m,
    backgroundColor: colors.background.secondary,
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colors.border.light,
  },
  earningsBlock: {
    flex: 1,
  },
  earningsLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.micro,
  },
  earningsLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.micro,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  earningsAmount: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
    color: colors.text.primary,
    marginTop: 2,
  },
  earningsCount: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
  earningsNote: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  earningsDivider: {
    width: 1,
    alignSelf: 'stretch',
    marginHorizontal: spacing.m,
    backgroundColor: colors.border.light,
  },
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    marginTop: spacing.m,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.m,
    borderRadius: radii.full,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  availabilityOn: {
    backgroundColor: colors.success.light,
    borderColor: colors.success.main,
  },
  availabilityOff: {
    backgroundColor: colors.background.secondary,
    borderColor: colors.border.light,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  availabilityText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
  },
  listContent: {
    padding: spacing.l,
    paddingTop: spacing.m,
    gap: spacing.m,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.s,
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
  timeText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
  },
  incidentType: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
    marginBottom: spacing.m,
  },
  addressSection: {
    marginBottom: spacing.s,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s,
  },
  addressLine: {
    width: 2,
    height: 24,
    backgroundColor: colors.border.light,
    marginLeft: 6,
    marginVertical: spacing.micro,
  },
  addressTextContainer: {
    flex: 1,
  },
  addressLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.micro,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addressText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginTop: 2,
  },
  pickupOnlyText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
    marginLeft: spacing.xl,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.m,
    marginBottom: spacing.s,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.s,
    backgroundColor: colors.background.secondary,
    borderRadius: radii.m,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metricText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
  userName: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    marginBottom: spacing.s,
  },
  photoContainer: {
    marginBottom: spacing.s,
    borderRadius: radii.m,
    overflow: 'hidden',
  },
  vehiclePhoto: {
    width: '100%',
    height: 150,
    borderRadius: radii.m,
  },
  notesText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    fontStyle: 'italic',
    marginBottom: spacing.s,
    backgroundColor: colors.background.secondary,
    padding: spacing.s,
    borderRadius: radii.m,
  },
  activeServiceWrapper: {
    padding: spacing.l,
  },
  activeServiceContent: {
    alignItems: 'center',
    gap: spacing.m,
  },
  activeServiceText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  // Para los estados sin lista: hace que el contenido corto siga llenando la
  // pantalla y que el ScrollView acepte el gesto de pull-to-refresh.
  pullable: {
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxxl,
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
    lineHeight: 22,
  },
  emptyAction: {
    marginTop: spacing.m,
    minWidth: 220,
  },
});
