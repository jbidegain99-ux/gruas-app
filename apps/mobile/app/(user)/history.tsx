import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Modal,
  ScrollView,
  Linking,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Clock, MapPin, MessageCircle, XCircle, CirclePlus, Truck, Phone } from 'lucide-react-native';
import { SERVICE_ICONS } from '@/lib/serviceIcons';
import { supabase } from '@/lib/supabase';
import { MoptBreakdown } from '@/features/coverage/components/MoptProgramBanner';
import { ChatScreen } from '@/features/chat/components/ChatScreen';
import { MiniMap } from '@/shared/components/MiniMap';
import { useServiceTrail } from '@/features/tracking/hooks/useServiceTrail';
import { AddressText } from '@/shared/components/AddressText';
import { isLateCancellation, lateCancellationWarning } from '@/lib/cancellation';
import { friendlyError } from '@/lib/errorMessages';
import { getAllPins } from '@/features/pin/lib/pinStorage';
import { SERVICE_TYPE_CONFIGS, requiresDropoff } from '@gruas-app/shared';
import type { ServiceType, ServiceRequestStatus } from '@gruas-app/shared';
import { BudiLogo, Button, Card, StatusBadge, LoadingSpinner, Input, PINInput, ErrorState, ToastHost, toast } from '@/shared/components/ui';
import { formatDateTime } from '@/lib/dates';
import { PaymentReceipt } from '@/features/payments/components/PaymentReceipt';
import { caseFolio } from '@/lib/caseFolio';
import { fetchRequestOperators } from '@/features/tracking/lib/requestOperators';
import { useInsurersEnabled } from '@/shared/hooks/usePlatformFeatures';
import { colors, typography, spacing, radii } from '@/theme';

type ServiceRequest = {
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
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  notes: string | null;
  operator_id: string | null;
  operator_name: string | null;
  operator_phone: string | null;
  provider_name: string | null;
  pin: string | null;
  service_type: string;
  // Cobertura: `total_price` es el precio bruto del servicio (lo que se le
  // factura al seguro), no lo que pago la persona. Sin esto el historial
  // contradecia el desglose que se le mostro antes de confirmar: un servicio
  // con copago $0 aparecia como "$60.00".
  coverage_status: string | null;
  /** 00098: lo pago un programa del MOPT; la persona no pago nada. */
  paid_by_mopt: boolean;
  /** Folio del caso (BUDI-000123): el número que el Usuario le da a soporte. */
  folio: string | null;
  amount_covered: number | null;
  amount_copay: number | null;
};

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Lo que realmente paga la persona por este servicio, o null si todavia no hay
 * un monto que mostrar.
 *
 * El estado va PRIMERO y no es opcional. La fila de `coverage_usage` nace al
 * crear la solicitud con 0/0 —la llena `complete_service_request` recien al
 * cerrar (00047)—, asi que `amount_copay` no nulo significa "esta persona tiene
 * poliza", no "esto costo cero". Sin este guard, toda solicitud de un afiliado
 * que no llegara a completarse (cancelada, asignada, en curso) se mostraba como
 * "Sin costo", como si el servicio se hubiera prestado gratis.
 *
 * Cubierto solo cuando existe el consumo: `coverage_status = 'covered'` se
 * decidio al crear la solicitud y pudo no terminar en consumo (servicio
 * excluido del plan).
 */
function precioAPagar(req: ServiceRequest): { valor: number; cubierto: boolean } | null {
  if (req.status !== 'completed') return null;
  // Lo pago el MOPT: no hay consumo de poliza, pero la persona no pago nada.
  // Sin esto caia al bruto y contradecia el "A pagar $0.00" del resumen.
  if (req.paid_by_mopt) return { valor: 0, cubierto: true };
  if (req.amount_copay != null) return { valor: req.amount_copay, cubierto: true };
  if (req.total_price != null) return { valor: req.total_price, cubierto: false };
  return null;
}

type FilterType = 'all' | 'active' | 'completed' | 'cancelled';

const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'active', label: 'Activas' },
  { key: 'completed', label: 'Completadas' },
  { key: 'cancelled', label: 'Canceladas' },
];

export default function History() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // 00153: con las aseguradoras apagadas no se muestra el desglose del seguro.
  const insurersOn = useInsurersEnabled();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  // Recorrido real del servicio seleccionado (se carga al abrir el detalle).
  const trail = useServiceTrail(detailModalVisible ? selectedRequest?.id : null);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [chatModalVisible, setChatModalVisible] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoadError(false);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return;
    }

    setCurrentUserId(user.id);

    // Load saved PINs from SecureStore (migrates from legacy AsyncStorage
    // on first call — see features/pin/lib/pinStorage.ts).
    let savedPins: Record<string, string> = {};
    try {
      savedPins = await getAllPins();
    } catch (e) {
      console.error('Error loading PINs:', e);
    }

    const query = supabase
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
        coverage_status,
        mopt_provider_id,
        created_at,
        completed_at,
        cancelled_at,
        cancelled_by,
        cancellation_reason,
        notes,
        operator_id,
        service_type,
        operator:profiles!service_requests_operator_id_fkey (full_name, phone),
        providers (name),
        cases (folio)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching requests:', error);
      setLoadError(true);
      setLoading(false);
      return;
    }

    if (data) {
      // El reparto seguro/copago vive en `coverage_usage`, no en
      // `service_requests`. La politica "Afiliado ve su consumo" deja al titular
      // leer sus propias filas, asi que va en una consulta aparte acotada a las
      // solicitudes que ya trajimos. Si falla, se cae al precio bruto — es peor
      // no mostrar nada que mostrar el bruto.
      const consumo = new Map<string, { covered: number; copay: number }>();
      const ids = data.map((r) => r.id);
      // 00138: nombre del socio por RPC (el embed a profiles vuelve null por RLS).
      const ops = await fetchRequestOperators(data.filter((r) => r.operator_id).map((r) => r.id));
      if (ids.length > 0) {
        const { data: usos, error: errUso } = await supabase
          .from('coverage_usage')
          .select('request_id, amount_covered, amount_copay')
          .in('request_id', ids);
        if (errUso) {
          console.error('Error loading coverage usage:', errUso.message);
        } else {
          for (const u of usos ?? []) {
            consumo.set(u.request_id, {
              covered: Number(u.amount_covered),
              copay: Number(u.amount_copay),
            });
          }
        }
      }

      const formattedRequests: ServiceRequest[] = data.map((req) => ({
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
        completed_at: req.completed_at,
        cancelled_at: req.cancelled_at,
        cancelled_by: (req as Record<string, unknown>).cancelled_by as string | null ?? null,
        cancellation_reason: (req as Record<string, unknown>).cancellation_reason as string | null ?? null,
        notes: req.notes,
        operator_id: req.operator_id,
        operator_name: (req.operator as unknown as { full_name: string; phone: string } | null)?.full_name || ops.get(req.id)?.name || null,
        operator_phone: (req.operator as unknown as { full_name: string; phone: string } | null)?.phone || ops.get(req.id)?.phone || null,
        provider_name: (req.providers as unknown as { name: string } | null)?.name || null,
        paid_by_mopt: req.mopt_provider_id != null,
        folio: caseFolio((req as Record<string, unknown>).cases),
        pin: savedPins[req.id] || null,
        service_type: req.service_type || 'tow',
        coverage_status: (req as Record<string, unknown>).coverage_status as string | null ?? null,
        amount_covered: consumo.get(req.id)?.covered ?? null,
        amount_copay: consumo.get(req.id)?.copay ?? null,
      }));
      setRequests(formattedRequests);
    }

    setLoading(false);
  }, []);

  // Re-fetch every time the tab gains focus (not just on mount)
  useFocusEffect(
    useCallback(() => {
      fetchRequests();
    }, [fetchRequests])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRequests();
    setRefreshing(false);
  };

  const filteredRequests = requests.filter((req) => {
    switch (filter) {
      case 'active':
        return ['initiated', 'assigned', 'en_route', 'active'].includes(req.status);
      case 'completed':
        return req.status === 'completed';
      case 'cancelled':
        return req.status === 'cancelled';
      default:
        return true;
    }
  });

  const formatDate = (dateString: string) =>
    formatDateTime(dateString, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const openDetail = (request: ServiceRequest) => {
    setSelectedRequest(request);
    setDetailModalVisible(true);
  };

  // Quien cancelo la solicitud, deducido comparando cancelled_by con el propio
  // usuario / el operador asignado. Si no coincide con ninguno, fue el equipo
  // (admin). currentUserId es el usuario que ve su historial.
  const cancelledByLabel = (req: ServiceRequest): string => {
    if (req.cancelled_by && req.cancelled_by === currentUserId) return 'Cancelada por ti';
    if (req.cancelled_by && req.cancelled_by === req.operator_id) {
      return req.operator_name ? `Cancelada por el socio operador (${req.operator_name})` : 'Cancelada por el socio operador';
    }
    return 'Cancelada por el equipo Budi';
  };

  const openCancelModal = () => {
    setCancelReason('');
    setCancelModalVisible(true);
  };

  const handleCancelRequest = async () => {
    if (!selectedRequest) {
      toast.error('No hay una solicitud seleccionada.');
      return;
    }

    if (!cancelReason.trim()) {
      toast.error('Ingresa un motivo de cancelación.');
      return;
    }

    setCancelling(true);

    try {
      const { data, error } = await supabase.rpc('cancel_service_request', {
        p_request_id: selectedRequest.id,
        p_reason: cancelReason.trim(),
      });

      if (error) {
        toast.error(friendlyError(error, 'No se pudo cancelar la solicitud.'));
        return;
      }

      if (data && !data.success) {
        toast.error(data.error || 'No se pudo cancelar la solicitud.');
        return;
      }

      toast.success('Tu solicitud fue cancelada.', 'Solicitud cancelada');
      setCancelModalVisible(false);
      setDetailModalVisible(false);
      setSelectedRequest(null);
      await fetchRequests();
    } catch (err: unknown) {
      toast.error(friendlyError(err as { message?: string }, 'No se pudo cancelar la solicitud. Intenta de nuevo.'));
    } finally {
      setCancelling(false);
    }
  };

  const renderRequestCard = ({ item }: { item: ServiceRequest }) => {
    const cfg = SERVICE_TYPE_CONFIGS[(item.service_type || 'tow') as ServiceType];
    const isTow = !item.service_type || item.service_type === 'tow';

    return (
      <Card variant="default" padding="m" onPress={() => openDetail(item)}>
        <View style={styles.cardHeader}>
          <StatusBadge status={item.status as ServiceRequestStatus} size="small" />
          <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
        </View>

        <Text style={styles.incidentType}>{item.incident_type}</Text>

        <View style={styles.addressRow}>
          <MapPin size={14} color={colors.success.main} />
          <AddressText
            style={styles.addressText}
            numberOfLines={1}
            address={item.pickup_address}
            lat={item.pickup_lat}
            lng={item.pickup_lng}
          />
        </View>
        {requiresDropoff(item.service_type) && (
          <View style={styles.addressRow}>
            <MapPin size={14} color={colors.error.main} />
            <AddressText
              style={styles.addressText}
              numberOfLines={1}
              address={item.dropoff_address}
              lat={item.dropoff_lat}
              lng={item.dropoff_lng}
            />
          </View>
        )}

        <View style={styles.cardFooter}>
          <View style={styles.serviceTypeRow}>
            {(() => {
              const SvcIcon = SERVICE_ICONS[(item.service_type || 'tow') as ServiceType] || Truck;
              return <SvcIcon size={14} color={cfg?.color || colors.primary[500]} strokeWidth={2} />;
            })()}
            <Text style={styles.towType}>
              {`${cfg?.name || 'Grúa'}${isTow ? ` - ${item.tow_type === 'light' ? 'Liviana' : 'Pesada'}` : ''}`}
            </Text>
          </View>
          {(() => {
            const pago = precioAPagar(item);
            if (!pago) return null;
            if (pago.cubierto && pago.valor <= 0) {
              return <Text style={styles.priceFree}>Sin costo</Text>;
            }
            return <Text style={styles.price}>{money(pago.valor)}</Text>;
          })()}
        </View>
      </Card>
    );
  };

  const renderDetailModal = () => {
    if (!selectedRequest) return null;

    // When chat is active, show ChatScreen inside the detail modal
    if (chatModalVisible && currentUserId) {
      return (
        <Modal
          visible={detailModalVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setChatModalVisible(false)}
        >
          <View style={{ flex: 1, backgroundColor: colors.background.primary }}>
            <ChatScreen
              requestId={selectedRequest.id}
              currentUserId={currentUserId}
              otherUserName={selectedRequest.operator_name || 'Socio operador'}
              onClose={() => setChatModalVisible(false)}
            />
            <ToastHost />
          </View>
        </Modal>
      );
    }

    return (
      <Modal
        visible={detailModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDetailModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Detalle de Solicitud</Text>
            <Pressable
              style={styles.closeButton}
              onPress={() => setDetailModalVisible(false)}
            >
              <Text style={styles.closeButtonText}>Cerrar</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.modalContent}>
            <View style={styles.detailStatusContainer}>
              <StatusBadge status={selectedRequest.status as ServiceRequestStatus} />
            </View>

            {/* Motivo de cancelacion (solo canceladas) */}
            {selectedRequest.status === 'cancelled' && (
              <View style={styles.cancelInfoSection}>
                <View style={styles.cancelInfoHeader}>
                  <XCircle size={16} color={colors.error.main} />
                  <Text style={styles.cancelInfoTitle}>{cancelledByLabel(selectedRequest)}</Text>
                </View>
                <Text style={styles.cancelInfoReason}>
                  {selectedRequest.cancellation_reason?.trim()
                    ? selectedRequest.cancellation_reason
                    : 'No se indicó un motivo.'}
                </Text>
              </View>
            )}

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Tipo de Incidente</Text>
              <Text style={styles.detailValue}>{selectedRequest.incident_type}</Text>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Tipo de Servicio</Text>
              <View style={styles.serviceTypeRow}>
                {(() => {
                  const svcType = (selectedRequest.service_type || 'tow') as ServiceType;
                  const cfg = SERVICE_TYPE_CONFIGS[svcType];
                  const isTow = !selectedRequest.service_type || selectedRequest.service_type === 'tow';
                  const SvcIcon = SERVICE_ICONS[svcType] || Truck;
                  return (
                    <>
                      <SvcIcon size={16} color={cfg?.color || colors.primary[500]} strokeWidth={2} />
                      <Text style={styles.detailValue}>
                        {cfg?.name || 'Grúa'}{isTow ? ` - ${selectedRequest.tow_type === 'light' ? 'Liviana' : 'Pesada'}` : ''}
                      </Text>
                    </>
                  );
                })()}
              </View>
            </View>

            {!!selectedRequest.pickup_lat && !!selectedRequest.pickup_lng && (
              <View style={styles.detailSection}>
                <MiniMap
                  pickup={{ lat: selectedRequest.pickup_lat, lng: selectedRequest.pickup_lng }}
                  dropoff={
                    requiresDropoff(selectedRequest.service_type) &&
                    selectedRequest.dropoff_lat &&
                    selectedRequest.dropoff_lng
                      ? { lat: selectedRequest.dropoff_lat, lng: selectedRequest.dropoff_lng }
                      : null
                  }
                  route={trail}
                  height={160}
                />
              </View>
            )}

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Ubicación de Recogida</Text>
              <AddressText
                style={styles.detailValue}
                address={selectedRequest.pickup_address}
                lat={selectedRequest.pickup_lat}
                lng={selectedRequest.pickup_lng}
              />
            </View>

            {requiresDropoff(selectedRequest.service_type) && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Destino</Text>
                <AddressText
                  style={styles.detailValue}
                  address={selectedRequest.dropoff_address}
                  lat={selectedRequest.dropoff_lat}
                  lng={selectedRequest.dropoff_lng}
                />
              </View>
            )}

            {selectedRequest.notes && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Notas</Text>
                <Text style={styles.detailValue}>{selectedRequest.notes}</Text>
              </View>
            )}

            {selectedRequest.operator_name && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Socio operador</Text>
                <Text style={styles.detailValue}>{selectedRequest.operator_name}</Text>
                {selectedRequest.provider_name && (
                  <Text style={styles.detailSubvalue}>
                    {selectedRequest.provider_name}
                  </Text>
                )}
              </View>
            )}

            {/* Show PIN for active requests */}
            {selectedRequest.pin && ['initiated', 'assigned', 'en_route', 'active'].includes(selectedRequest.status) && (
              <View style={styles.pinSection}>
                <Text style={styles.pinLabel}>PIN de confirmación para el socio</Text>
                <PINInput
                  value={selectedRequest.pin}
                  onChangeText={() => {}}
                  displayOnly
                />
                <Text style={styles.pinNote}>
                  Muéstrale este PIN al socio operador cuando llegue para iniciar el servicio.
                </Text>
              </View>
            )}

            {(() => {
              const pago = precioAPagar(selectedRequest);
              if (!pago) return null;
              const sinCosto = pago.cubierto && pago.valor <= 0;
              return (
                <View style={styles.priceSection}>
                  <Text style={styles.priceSectionLabel}>
                    {pago.cubierto ? 'Lo que pagaste' : 'Precio Final'}
                  </Text>
                  <Text style={styles.priceSectionValue}>
                    {sinCosto ? 'Sin costo' : money(pago.valor)}
                  </Text>
                  {selectedRequest.paid_by_mopt && (
                    <>
                      <Text style={styles.coverageLabel}>
                        Lo cubrió el programa de asistencia vial del MOPT.
                      </Text>
                      {/* VID-02: el mismo desglose que vio antes de confirmar. */}
                      {selectedRequest.total_price != null && selectedRequest.total_price > 0 && (
                        <MoptBreakdown price={selectedRequest.total_price} />
                      )}
                    </>
                  )}
                  {/* El desglose solo cuando el seguro puso algo: repite el mismo
                      reparto que se le mostro antes de confirmar (B-13). Si el
                      servicio estaba excluido del plan, `amount_covered` es 0 y
                      las dos lineas dirian "$35.00" y "−$0.00" — ruido: ahi el
                      monto de arriba ya es toda la historia. */}
                  {insurersOn && pago.cubierto && (selectedRequest.amount_covered ?? 0) > 0 && (
                    <View style={styles.coverageBreakdown}>
                      <View style={styles.coverageRow}>
                        <Text style={styles.coverageLabel}>Precio del servicio</Text>
                        <Text style={styles.coverageValue}>
                          {money(selectedRequest.total_price ?? 0)}
                        </Text>
                      </View>
                      <View style={styles.coverageRow}>
                        <Text style={styles.coverageLabel}>Cubrió tu seguro</Text>
                        <Text style={styles.coverageValue}>
                          −{money(selectedRequest.amount_covered ?? 0)}
                        </Text>
                      </View>
                    </View>
                  )}
                  {/* LAN-07 (00133): comprobante o pago pendiente. */}
                  {selectedRequest.status === 'completed' && <PaymentReceipt requestId={selectedRequest.id} />}
                </View>
              );
            })()}

            <View style={styles.timelineSection}>
              <Text style={styles.timelineTitle}>Fechas</Text>
              <View style={styles.timelineRow}>
                <Text style={styles.timelineLabel}>Creada:</Text>
                <Text style={styles.timelineValue}>
                  {formatDate(selectedRequest.created_at)}
                </Text>
              </View>
              {selectedRequest.completed_at && (
                <View style={styles.timelineRow}>
                  <Text style={styles.timelineLabel}>Completada:</Text>
                  <Text style={styles.timelineValue}>
                    {formatDate(selectedRequest.completed_at)}
                  </Text>
                </View>
              )}
              {selectedRequest.cancelled_at && (
                <View style={styles.timelineRow}>
                  <Text style={styles.timelineLabel}>Cancelada:</Text>
                  <Text style={styles.timelineValue}>
                    {formatDate(selectedRequest.cancelled_at)}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.idSection}>
              <Text style={styles.idLabel}>Folio</Text>
              <Text style={styles.idValue}>{selectedRequest.folio ?? selectedRequest.id}</Text>
            </View>

            {/* Contacto con el operador (chat + llamada) en servicios activos */}
            {selectedRequest.operator_id && ['assigned', 'en_route', 'active'].includes(selectedRequest.status) && (
              <View style={styles.contactRow}>
                <View style={styles.contactBtn}>
                  <Button
                    title="Chat"
                    onPress={() => setChatModalVisible(true)}
                    variant="secondary"
                    size="medium"
                    icon={<MessageCircle size={18} color={colors.primary[500]} />}
                  />
                </View>
                <View style={styles.contactBtn}>
                  <Button
                    title="Llamar"
                    onPress={() => {
                      if (selectedRequest.operator_phone) {
                        Linking.openURL(`tel:${selectedRequest.operator_phone}`);
                      } else {
                        toast.info('El socio operador no tiene un teléfono registrado.', 'Sin teléfono');
                      }
                    }}
                    variant="secondary"
                    size="medium"
                    icon={<Phone size={18} color={colors.primary[500]} />}
                  />
                </View>
              </View>
            )}

            {/* Cancel Button for active requests */}
            {['initiated', 'assigned', 'en_route'].includes(selectedRequest.status) && (
              <View style={styles.cancelButtonContainer}>
                <Button
                  title="Cancelar Solicitud"
                  onPress={openCancelModal}
                  variant="tertiary"
                  size="medium"
                  icon={<XCircle size={18} color={colors.primary[500]} />}
                />
              </View>
            )}

            <View style={styles.modalBottomSpacer} />
          </ScrollView>
          {/* Los toasts se pintan sobre el Modal nativo, no detrás. */}
          <ToastHost />
        </View>
      </Modal>
    );
  };

  const renderCancelModal = () => (
    <Modal
      visible={cancelModalVisible}
      animationType="fade"
      transparent={true}
      onRequestClose={() => setCancelModalVisible(false)}
    >
      <View style={styles.cancelModalOverlay}>
        <View style={styles.cancelModalContent}>
          <Text style={styles.cancelModalTitle}>Cancelar Solicitud</Text>
          {selectedRequest && isLateCancellation(selectedRequest.status) && (
            <Text style={styles.cancelModalWarning}>
              {lateCancellationWarning(selectedRequest.paid_by_mopt)}
            </Text>
          )}
          <Text style={styles.cancelModalSubtitle}>
            Indica el motivo de la cancelación
          </Text>

          <Input
            label=""
            placeholder="Escribe el motivo..."
            value={cancelReason}
            onChangeText={setCancelReason}
            multiline
            numberOfLines={3}
          />

          <View style={styles.cancelModalButtons}>
            <View style={styles.cancelModalBtnHalf}>
              <Button
                title="Volver"
                onPress={() => setCancelModalVisible(false)}
                variant="secondary"
                size="medium"
                disabled={cancelling}
              />
            </View>
            <View style={styles.cancelModalBtnHalf}>
              <Button
                title="Confirmar"
                onPress={handleCancelRequest}
                size="medium"
                loading={cancelling}
                disabled={cancelling}
              />
            </View>
          </View>
        </View>
        <ToastHost />
      </View>
    </Modal>
  );

  if (loading) {
    return <LoadingSpinner fullScreen />;
  }

  if (loadError) {
    return (
      <ErrorState
        fullScreen
        offline
        title="No pudimos cargar tu historial"
        message="Revisa tu conexión a internet e intenta de nuevo."
        onRetry={fetchRequests}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.l }]}>
        <BudiLogo variant="wordmark" height={28} />
        <Text style={styles.title}>Historial</Text>
        <Text style={styles.subtitle}>Tus solicitudes de servicio</Text>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {FILTER_OPTIONS.map((option) => (
            <Pressable
              key={option.key}
              style={[
                styles.filterButton,
                filter === option.key && styles.filterButtonActive,
              ]}
              onPress={() => setFilter(option.key)}
            >
              <Text
                style={[
                  styles.filterText,
                  filter === option.key && styles.filterTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {filteredRequests.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Clock size={56} color={colors.text.tertiary} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>
            {filter === 'all'
              ? 'Sin solicitudes'
              : filter === 'active'
              ? 'Sin solicitudes activas'
              : filter === 'completed'
              ? 'Sin solicitudes completadas'
              : 'Sin solicitudes canceladas'}
          </Text>
          <Text style={styles.emptyText}>
            {filter === 'all'
              ? 'Aún no has realizado ninguna solicitud de servicio.'
              : 'No hay solicitudes en esta categoría.'}
          </Text>
          {filter === 'all' && (
            <View style={styles.emptyCta}>
              <Button
                title="Solicitar Servicio"
                onPress={() => router.push('/(user)/request')}
                size="medium"
                icon={<CirclePlus size={18} color={colors.white} />}
              />
            </View>
          )}
        </View>
      ) : (
        <FlatList
          data={filteredRequests}
          renderItem={renderRequestCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      {renderDetailModal()}
      {renderCancelModal()}
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
    paddingTop: spacing.l,
    paddingBottom: spacing.s,
    backgroundColor: colors.background.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  title: {
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
  filterContainer: {
    backgroundColor: colors.background.primary,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  filterButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.m,
    borderRadius: radii.full,
    backgroundColor: colors.background.tertiary,
    marginRight: spacing.xs,
  },
  filterButtonActive: {
    backgroundColor: colors.primary[500],
  },
  filterText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
  },
  filterTextActive: {
    color: colors.text.inverse,
  },
  listContent: {
    padding: spacing.m,
  },
  separator: {
    height: spacing.s,
  },
  // Card
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.s,
  },
  cardDate: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
  },
  incidentType: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
    marginBottom: spacing.s,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.micro + 2,
  },
  addressText: {
    flex: 1,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.s,
    paddingTop: spacing.s,
    borderTopWidth: 1,
    borderTopColor: colors.border.light,
  },
  serviceTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  towType: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
  price: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.body,
    color: colors.accent[600],
  },
  priceFree: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.body,
    color: colors.success.dark,
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxxl,
  },
  emptyTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.h4,
    color: colors.text.primary,
    marginTop: spacing.m,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: typography.lineHeights.bodySmall,
  },
  emptyCta: {
    marginTop: spacing.l,
    width: '100%',
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
  modalTitle: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
  },
  closeButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.m,
  },
  closeButtonText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.primary[500],
  },
  modalContent: {
    flex: 1,
    padding: spacing.l,
  },
  detailStatusContainer: {
    marginBottom: spacing.xl,
  },
  cancelInfoSection: {
    backgroundColor: colors.error.light,
    borderRadius: radii.m,
    padding: spacing.m,
    marginBottom: spacing.l,
    borderWidth: 1,
    borderColor: colors.error.main,
  },
  cancelInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  cancelInfoTitle: {
    flex: 1,
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.error.dark,
  },
  cancelInfoReason: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
    lineHeight: typography.lineHeights.body,
  },
  detailSection: {
    marginBottom: spacing.l,
  },
  detailLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    marginBottom: spacing.micro,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
    lineHeight: typography.lineHeights.body,
  },
  detailSubvalue: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginTop: 2,
  },
  priceSection: {
    backgroundColor: colors.success.light,
    padding: spacing.m,
    borderRadius: radii.m,
    marginBottom: spacing.l,
    alignItems: 'center',
  },
  priceSectionLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.success.dark,
    marginBottom: spacing.micro,
  },
  priceSectionValue: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h1,
    color: colors.success.dark,
  },
  coverageBreakdown: {
    alignSelf: 'stretch',
    marginTop: spacing.s,
    paddingTop: spacing.s,
    borderTopWidth: 1,
    borderTopColor: colors.success.dark,
    opacity: 0.85,
  },
  coverageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  coverageLabel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.success.dark,
  },
  coverageValue: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.success.dark,
  },
  timelineSection: {
    backgroundColor: colors.background.secondary,
    padding: spacing.m,
    borderRadius: radii.m,
    marginBottom: spacing.l,
  },
  timelineTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
    marginBottom: spacing.s,
  },
  timelineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  timelineLabel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
  },
  timelineValue: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
  },
  idSection: {
    paddingTop: spacing.l,
    borderTopWidth: 1,
    borderTopColor: colors.border.light,
    marginBottom: spacing.l,
  },
  idLabel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
    marginBottom: spacing.micro,
  },
  idValue: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
  },
  pinSection: {
    backgroundColor: colors.accent[50],
    padding: spacing.m,
    borderRadius: radii.m,
    marginBottom: spacing.l,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.accent[500],
  },
  pinLabel: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.caption,
    color: colors.accent[700],
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  pinNote: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.accent[700],
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  contactRow: {
    flexDirection: 'row',
    gap: spacing.s,
  },
  contactBtn: {
    flex: 1,
  },
  cancelButtonContainer: {
    marginTop: spacing.s,
  },
  modalBottomSpacer: {
    height: spacing.xxxl,
  },
  // Cancel Modal
  cancelModalOverlay: {
    flex: 1,
    backgroundColor: colors.background.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.l,
  },
  cancelModalContent: {
    backgroundColor: colors.background.primary,
    borderRadius: radii.l,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400,
  },
  cancelModalTitle: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  cancelModalSubtitle: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginBottom: spacing.m,
  },
  cancelModalWarning: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.warning.dark,
    backgroundColor: colors.warning.light,
    padding: spacing.s,
    borderRadius: radii.m,
    marginBottom: spacing.s,
  },
  cancelModalButtons: {
    flexDirection: 'row',
    gap: spacing.s,
    marginTop: spacing.m,
  },
  cancelModalBtnHalf: {
    flex: 1,
  },
});
