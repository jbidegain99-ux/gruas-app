import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { ChatScreen } from '@/components/ChatScreen';

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
};

type FilterType = 'all' | 'active' | 'completed' | 'cancelled';

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  initiated: { label: 'Buscando Operador', color: '#ca8a04', bgColor: '#fef9c3' },
  assigned: { label: 'Operador Asignado', color: '#2563eb', bgColor: '#dbeafe' },
  en_route: { label: 'Grua en Camino', color: '#7c3aed', bgColor: '#ede9fe' },
  active: { label: 'Servicio en Curso', color: '#16a34a', bgColor: '#dcfce7' },
  completed: { label: 'Completado', color: '#6b7280', bgColor: '#f3f4f6' },
  cancelled: { label: 'Cancelado', color: '#dc2626', bgColor: '#fee2e2' },
};

const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'active', label: 'Activas' },
  { key: 'completed', label: 'Completadas' },
  { key: 'cancelled', label: 'Canceladas' },
];

export default function History() {
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
      }));
      setRequests(formattedRequests);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

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
    console.log('=== CANCEL REQUEST STARTED ===');
    console.log('selectedRequest:', selectedRequest?.id);

    if (!selectedRequest) {
      console.error('No request selected!');
      Alert.alert('Error', 'No hay solicitud seleccionada');
      return;
    }

    if (!cancelReason.trim()) {
      Alert.alert('Error', 'Por favor ingresa un motivo de cancelacion');
      return;
    }

    setCancelling(true);

    try {
      console.log('Calling cancel_service_request RPC...');
      const { data, error } = await supabase.rpc('cancel_service_request', {
        p_request_id: selectedRequest.id,
        p_reason: cancelReason.trim(),
      });

      console.log('RPC response - data:', data);
      console.log('RPC response - error:', error);

      if (error) {
        console.error('Supabase RPC error:', error);
        Alert.alert('Error', error.message || 'No se pudo cancelar la solicitud');
        return;
      }

      if (data && !data.success) {
        console.error('RPC returned error:', data.error);
        Alert.alert('Error', data.error || 'No se pudo cancelar la solicitud');
        return;
      }

      console.log('Request cancelled successfully');
      Alert.alert('Solicitud Cancelada', 'Tu solicitud ha sido cancelada exitosamente');
      setCancelModalVisible(false);
      setDetailModalVisible(false);
      setSelectedRequest(null);
      await fetchRequests();
    } catch (err: any) {
      console.error('=== CANCEL ERROR ===');
      console.error('Error object:', err);
      console.error('Error message:', err?.message);
      Alert.alert(
        'Error',
        err?.message || 'No se pudo cancelar la solicitud. Intenta de nuevo.'
      );
    } finally {
      setCancelling(false);
      console.log('=== CANCEL REQUEST FINISHED ===');
    }
  };

  const renderRequestCard = ({ item }: { item: ServiceRequest }) => {
    const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.initiated;

    return (
      <TouchableOpacity style={styles.card} onPress={() => openDetail(item)}>
        <View style={styles.cardHeader}>
          <View
            style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor }]}
          >
            <View style={[styles.statusDot, { backgroundColor: statusConfig.color }]} />
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
          <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
        </View>

        <Text style={styles.incidentType}>{item.incident_type}</Text>

        <View style={styles.addressRow}>
          <View style={[styles.dot, { backgroundColor: '#16a34a' }]} />
          <Text style={styles.addressText} numberOfLines={1}>
            {item.pickup_address}
          </Text>
        </View>
        <View style={styles.addressRow}>
          <View style={[styles.dot, { backgroundColor: '#dc2626' }]} />
          <Text style={styles.addressText} numberOfLines={1}>
            {item.dropoff_address}
          </Text>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.towType}>
            {item.tow_type === 'light' ? 'Grua Liviana' : 'Grua Pesada'}
          </Text>
          {item.total_price && (
            <Text style={styles.price}>${item.total_price.toFixed(2)}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderDetailModal = () => {
    if (!selectedRequest) return null;

    const statusConfig = STATUS_CONFIG[selectedRequest.status] || STATUS_CONFIG.initiated;

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
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setDetailModalVisible(false)}
            >
              <Text style={styles.closeButtonText}>Cerrar</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <View
              style={[
                styles.detailStatusBadge,
                { backgroundColor: statusConfig.bgColor },
              ]}
            >
              <View
                style={[styles.statusDot, { backgroundColor: statusConfig.color }]}
              />
              <Text style={[styles.detailStatusText, { color: statusConfig.color }]}>
                {statusConfig.label}
              </Text>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Tipo de Incidente</Text>
              <Text style={styles.detailValue}>{selectedRequest.incident_type}</Text>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Tipo de Grua</Text>
              <Text style={styles.detailValue}>
                {selectedRequest.tow_type === 'light' ? 'Liviana' : 'Pesada'}
              </Text>
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
              <TouchableOpacity
                style={styles.chatButton}
                onPress={() => {
                  console.log('=== CHAT BUTTON PRESSED ===');
                  console.log('selectedRequest.id:', selectedRequest?.id);
                  console.log('selectedRequest.operator_id:', selectedRequest?.operator_id);
                  console.log('selectedRequest.operator_name:', selectedRequest?.operator_name);
                  console.log('currentUserId:', currentUserId);
                  console.log('Setting chatModalVisible to true...');
                  setChatModalVisible(true);
                }}
              >
                <Text style={styles.chatButtonText}>Abrir Chat con Operador</Text>
              </TouchableOpacity>
            )}

            {/* Cancel Button for active requests */}
            {['initiated', 'assigned', 'en_route'].includes(selectedRequest.status) && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={openCancelModal}
              >
                <Text style={styles.cancelButtonText}>Cancelar Solicitud</Text>
              </TouchableOpacity>
            )}
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

          <TextInput
            style={styles.cancelReasonInput}
            placeholder="Escribe el motivo..."
            value={cancelReason}
            onChangeText={setCancelReason}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          <View style={styles.cancelModalButtons}>
            <TouchableOpacity
              style={styles.cancelModalButtonSecondary}
              onPress={() => setCancelModalVisible(false)}
              disabled={cancelling}
            >
              <Text style={styles.cancelModalButtonSecondaryText}>Volver</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelModalButtonPrimary, cancelling && styles.buttonDisabled]}
              onPress={handleCancelRequest}
              disabled={cancelling}
            >
              {cancelling ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.cancelModalButtonPrimaryText}>Confirmar</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Cargando historial...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Historial</Text>
        <Text style={styles.subtitle}>Tus solicitudes de servicio</Text>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {FILTER_OPTIONS.map((option) => (
            <TouchableOpacity
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
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {filteredRequests.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>
            {filter === 'all' ? '📋' : filter === 'active' ? '🔄' : filter === 'completed' ? '✅' : '❌'}
          </Text>
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

      {/* Chat Modal */}
      {selectedRequest && currentUserId && chatModalVisible && (
        <Modal
          visible={chatModalVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setChatModalVisible(false)}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }} edges={['top', 'bottom']}>
            <ChatScreen
              requestId={selectedRequest.id}
              currentUserId={currentUserId}
              otherUserName={selectedRequest.operator_name}
              onClose={() => setChatModalVisible(false)}
            />
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
  },
  header: {
    padding: 20,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
    marginTop: 4,
  },
  filterContainer: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  filterButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    marginRight: 8,
  },
  filterButtonActive: {
    backgroundColor: '#2563eb',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
  },
  filterTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: 16,
  },
  separator: {
    height: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardDate: {
    fontSize: 12,
    color: '#9ca3af',
  },
  incidentType: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  addressText: {
    flex: 1,
    fontSize: 14,
    color: '#4b5563',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  towType: {
    fontSize: 13,
    color: '#6b7280',
  },
  price: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  // Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  closeButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  closeButtonText: {
    fontSize: 16,
    color: '#2563eb',
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  detailStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 8,
    marginBottom: 24,
  },
  detailStatusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  detailSection: {
    marginBottom: 20,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 16,
    color: '#111827',
    lineHeight: 22,
  },
  detailSubvalue: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  priceSection: {
    backgroundColor: '#f0fdf4',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: 'center',
  },
  priceSectionLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#16a34a',
    marginBottom: 4,
  },
  priceSectionValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#16a34a',
  },
  timelineSection: {
    backgroundColor: '#f9fafb',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  timelineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  timelineLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  timelineValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  idSection: {
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    marginBottom: 40,
  },
  idLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  idValue: {
    fontSize: 12,
    color: '#9ca3af',
    fontFamily: 'monospace',
  },
  pinSection: {
    backgroundColor: '#fef3c7',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#f59e0b',
  },
  pinLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400e',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  pinValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#92400e',
    letterSpacing: 8,
  },
  pinNote: {
    fontSize: 12,
    color: '#92400e',
    textAlign: 'center',
    marginTop: 8,
  },
  chatButton: {
    backgroundColor: '#dbeafe',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  chatButtonText: {
    color: '#2563eb',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: '#fee2e2',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 40,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  cancelButtonText: {
    color: '#dc2626',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  cancelModalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  cancelModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  cancelModalSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
  },
  cancelReasonInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
    backgroundColor: '#f9fafb',
    marginBottom: 20,
  },
  cancelModalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelModalButtonSecondary: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  cancelModalButtonSecondaryText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelModalButtonPrimary: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#dc2626',
  },
  cancelModalButtonPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
