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
  Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Clock, MapPin, MessageCircle, XCircle, CirclePlus, Truck } from 'lucide-react-native';
import { SERVICE_ICONS } from '@/lib/serviceIcons';
import { supabase } from '@/lib/supabase';
import { ChatScreen } from '@/components/ChatScreen';
import { SERVICE_TYPE_CONFIGS } from '@gruas-app/shared';
import type { ServiceType, ServiceRequestStatus } from '@gruas-app/shared';
import { BudiLogo, Button, Card, StatusBadge, LoadingSpinner, Input } from '@/components/ui';
import { colors, typography, spacing, radii } from '@/theme';

type ServiceRequest = {
  id: string;
  status: string;
  tow_type: string;
  incident_type: string;
  pickup_address: string;
  dropoff_address: string;
  total_price: number | null;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  operator_id: string | null;
  operator_name: string | null;
  provider_name: string | null;
  pin: string | null;
  service_type: string;
};

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
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [chatModalVisible, setChatModalVisible] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return;
    }

    setCurrentUserId(user.id);

    // Load saved PINs from local storage
    let savedPins: Record<string, string> = {};
    try {
      const pinsData = await AsyncStorage.getItem('request_pins');
      if (pinsData) {
        savedPins = JSON.parse(pinsData);
      }
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
        dropoff_address,
        total_price,
        created_at,
        completed_at,
        cancelled_at,
        notes,
        operator_id,
        service_type,
        operator:profiles!service_requests_operator_id_fkey (full_name),
        providers (name)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching requests:', error);
      setLoading(false);
      return;
    }

    if (data) {
      const formattedRequests: ServiceRequest[] = data.map((req) => ({
        id: req.id,
        status: req.status,
        tow_type: req.tow_type,
        incident_type: req.incident_type,
        pickup_address: req.pickup_address,
        dropoff_address: req.dropoff_address,
        total_price: req.total_price,
        created_at: req.created_at,
        completed_at: req.completed_at,
        cancelled_at: req.cancelled_at,
        notes: req.notes,
        operator_id: req.operator_id,
        operator_name: (req.operator as unknown as { full_name: string } | null)?.full_name || null,
        provider_name: (req.providers as unknown as { name: string } | null)?.name || null,
        pin: savedPins[req.id] || null,
        service_type: req.service_type || 'tow',
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const openDetail = (request: ServiceRequest) => {
    setSelectedRequest(request);
    setDetailModalVisible(true);
  };

  const openCancelModal = () => {
    setCancelReason('');
    setCancelModalVisible(true);
  };

  const handleCancelRequest = async () => {
    if (!selectedRequest) {
      Alert.alert('Error', 'No hay solicitud seleccionada');
      return;
    }

    if (!cancelReason.trim()) {
      Alert.alert('Error', 'Por favor ingresa un motivo de cancelacion');
      return;
    }

    setCancelling(true);

    try {
      const { data, error } = await supabase.rpc('cancel_service_request', {
        p_request_id: selectedRequest.id,
        p_reason: cancelReason.trim(),
      });

      if (error) {
        Alert.alert('Error', error.message || 'No se pudo cancelar la solicitud');
        return;
      }

      if (data && !data.success) {
        Alert.alert('Error', data.error || 'No se pudo cancelar la solicitud');
        return;
      }

      Alert.alert('Solicitud Cancelada', 'Tu solicitud ha sido cancelada exitosamente');
      setCancelModalVisible(false);
      setDetailModalVisible(false);
      setSelectedRequest(null);
      await fetchRequests();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'No se pudo cancelar la solicitud. Intenta de nuevo.';
      Alert.alert('Error', message);
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
          <Text style={styles.addressText} numberOfLines={1}>
            {item.pickup_address}
          </Text>
        </View>
        <View style={styles.addressRow}>
          <MapPin size={14} color={colors.error.main} />
          <Text style={styles.addressText} numberOfLines={1}>
            {item.dropoff_address}
          </Text>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.serviceTypeRow}>
            {(() => {
              const SvcIcon = SERVICE_ICONS[(item.service_type || 'tow') as ServiceType] || Truck;
              return <SvcIcon size={14} color={cfg?.color || colors.primary[500]} strokeWidth={2} />;
            })()}
            <Text style={styles.towType}>
              {`${cfg?.name || 'Grua'}${isTow ? ` - ${item.tow_type === 'light' ? 'Liviana' : 'Pesada'}` : ''}`}
            </Text>
          </View>
          {item.total_price && (
            <Text style={styles.price}>${item.total_price.toFixed(2)}</Text>
          )}
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
              otherUserName={selectedRequest.operator_name || 'Operador'}
              onClose={() => setChatModalVisible(false)}
            />
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
                        {cfg?.name || 'Grua'}{isTow ? ` - ${selectedRequest.tow_type === 'light' ? 'Liviana' : 'Pesada'}` : ''}
                      </Text>
                    </>
                  );
                })()}
              </View>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Ubicacion de Recogida</Text>
              <Text style={styles.detailValue}>{selectedRequest.pickup_address}</Text>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Destino</Text>
              <Text style={styles.detailValue}>{selectedRequest.dropoff_address}</Text>
            </View>

            {selectedRequest.notes && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Notas</Text>
                <Text style={styles.detailValue}>{selectedRequest.notes}</Text>
              </View>
            )}

            {selectedRequest.operator_name && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Operador</Text>
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
                <Text style={styles.pinLabel}>PIN de Verificacion</Text>
                <Text style={styles.pinValue}>{selectedRequest.pin}</Text>
                <Text style={styles.pinNote}>
                  Muestra este PIN al operador cuando llegue la grua
                </Text>
              </View>
            )}

            {selectedRequest.total_price && (
              <View style={styles.priceSection}>
                <Text style={styles.priceSectionLabel}>Precio Final</Text>
                <Text style={styles.priceSectionValue}>
                  ${selectedRequest.total_price.toFixed(2)}
                </Text>
              </View>
            )}

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
              <Text style={styles.idLabel}>ID de Solicitud</Text>
              <Text style={styles.idValue}>{selectedRequest.id}</Text>
            </View>

            {/* Chat Button for active requests with operator */}
            {selectedRequest.operator_id && ['assigned', 'en_route', 'active'].includes(selectedRequest.status) && (
              <Button
                title="Chat con Operador"
                onPress={() => setChatModalVisible(true)}
                variant="secondary"
                size="medium"
                icon={<MessageCircle size={18} color={colors.primary[500]} />}
              />
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
          <Text style={styles.cancelModalSubtitle}>
            Por favor indica el motivo de la cancelacion
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
      </View>
    </Modal>
  );

  if (loading) {
    return <LoadingSpinner fullScreen />;
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
              ? 'Aun no has realizado ninguna solicitud de servicio.'
              : 'No hay solicitudes en esta categoria.'}
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
  pinValue: {
    fontFamily: typography.fonts.headingExtra,
    fontSize: typography.sizes.hero,
    color: colors.accent[700],
    letterSpacing: 8,
  },
  pinNote: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.accent[700],
    textAlign: 'center',
    marginTop: spacing.xs,
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
  cancelModalButtons: {
    flexDirection: 'row',
    gap: spacing.s,
    marginTop: spacing.m,
  },
  cancelModalBtnHalf: {
    flex: 1,
  },
});
