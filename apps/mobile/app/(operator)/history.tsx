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
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Clock, MapPin, Phone, Truck, CheckCircle2 } from 'lucide-react-native';
import { SERVICE_ICONS } from '@/lib/serviceIcons';
import { supabase } from '@/lib/supabase';
import { money, startOfToday, startOfWeek } from '@/lib/earnings';
import { MiniMap } from '@/shared/components/MiniMap';
import { useServiceTrail } from '@/features/tracking/hooks/useServiceTrail';
import { AddressText } from '@/shared/components/AddressText';
import { SERVICE_TYPE_CONFIGS, requiresDropoff } from '@gruas-app/shared';
import type { ServiceType, ServiceRequestStatus } from '@gruas-app/shared';
import { BudiLogo, Card, StatusBadge, LoadingSpinner, ErrorState } from '@/shared/components/ui';
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
  notes: string | null;
  user_name: string | null;
  user_phone: string | null;
  service_type: string;
};

type FilterType = 'all' | 'completed' | 'cancelled';

const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'completed', label: 'Completados' },
  { key: 'cancelled', label: 'Cancelados' },
];

export default function OperatorHistory() {
  const insets = useSafeAreaInsets();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  // Recorrido real del servicio seleccionado (se carga al abrir el detalle).
  const trail = useServiceTrail(detailModalVisible ? selectedRequest?.id : null);

  const fetchRequests = useCallback(async () => {
    setLoadError(false);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return;
    }

    // Solo servicios ya resueltos (o cancelados) asignados a este operador.
    const { data, error } = await supabase
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
        completed_at,
        cancelled_at,
        notes,
        service_type,
        profiles!service_requests_user_id_fkey (full_name, phone)
      `)
      .eq('operator_id', user.id)
      .in('status', ['completed', 'cancelled'])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching operator history:', error);
      setLoadError(true);
      setLoading(false);
      return;
    }

    if (data) {
      const formatted: ServiceRequest[] = data.map((req) => ({
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
        notes: req.notes,
        user_name: (req.profiles as unknown as { full_name: string } | null)?.full_name || null,
        user_phone: (req.profiles as unknown as { phone: string } | null)?.phone || null,
        service_type: req.service_type || 'tow',
      }));
      setRequests(formatted);
    }

    setLoading(false);
  }, []);

  // Re-fetch cada vez que la pestana gana foco (no solo al montar)
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
      case 'completed':
        return req.status === 'completed';
      case 'cancelled':
        return req.status === 'cancelled';
      default:
        return true;
    }
  });

  // Resumen: cantidad y ganancias (hoy / semana / histórico) de servicios completados
  const completed = requests.filter((r) => r.status === 'completed');
  const totalEarned = completed.reduce((sum, r) => sum + (r.total_price || 0), 0);
  const todayIso = startOfToday().toISOString();
  const weekIso = startOfWeek().toISOString();
  const earnedSince = (sinceIso: string) =>
    completed
      .filter((r) => r.completed_at && r.completed_at >= sinceIso)
      .reduce((sum, r) => sum + (r.total_price || 0), 0);
  const earnedToday = earnedSince(todayIso);
  const earnedWeek = earnedSince(weekIso);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-SV', {
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

  const renderRequestCard = ({ item }: { item: ServiceRequest }) => {
    const cfg = SERVICE_TYPE_CONFIGS[(item.service_type || 'tow') as ServiceType];
    const isTow = !item.service_type || item.service_type === 'tow';

    return (
      <Card variant="default" padding="m" onPress={() => openDetail(item)}>
        <View style={styles.cardHeader}>
          <StatusBadge status={item.status as ServiceRequestStatus} size="small" />
          <Text style={styles.cardDate}>{formatDate(item.completed_at || item.cancelled_at || item.created_at)}</Text>
        </View>

        <Text style={styles.incidentType}>{item.incident_type}</Text>

        {item.user_name && (
          <Text style={styles.clientName}>Cliente: {item.user_name}</Text>
        )}

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
              {`${cfg?.name || 'Grua'}${isTow ? ` - ${item.tow_type === 'light' ? 'Liviana' : 'Pesada'}` : ''}`}
            </Text>
          </View>
          {item.status === 'completed' && item.total_price != null && (
            <Text style={styles.price}>${item.total_price.toFixed(2)}</Text>
          )}
        </View>
      </Card>
    );
  };

  const renderDetailModal = () => {
    if (!selectedRequest) return null;

    return (
      <Modal
        visible={detailModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDetailModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Detalle del Servicio</Text>
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

            {selectedRequest.user_name && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Cliente</Text>
                <Text style={styles.detailValue}>{selectedRequest.user_name}</Text>
                {selectedRequest.user_phone && (
                  <View style={styles.phoneRow}>
                    <Phone size={14} color={colors.text.secondary} />
                    <Text style={styles.detailSubvalue}>{selectedRequest.user_phone}</Text>
                  </View>
                )}
              </View>
            )}

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

            {selectedRequest.status === 'completed' && selectedRequest.total_price != null && (
              <View style={styles.priceSection}>
                <Text style={styles.priceSectionLabel}>Ganancia del Servicio</Text>
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
              <Text style={styles.idLabel}>ID de Servicio</Text>
              <Text style={styles.idValue}>{selectedRequest.id}</Text>
            </View>

            <View style={styles.modalBottomSpacer} />
          </ScrollView>
        </View>
      </Modal>
    );
  };

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
        <Text style={styles.subtitle}>Servicios que has realizado</Text>
      </View>

      {/* Resumen */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <CheckCircle2 size={18} color={colors.success.main} strokeWidth={2} />
          <Text style={styles.summaryValue}>{completed.length}</Text>
          <Text style={styles.summaryLabel}>Completados</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryEarned}>{money(earnedToday)}</Text>
          <Text style={styles.summaryLabel}>Hoy</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryEarned}>{money(earnedWeek)}</Text>
          <Text style={styles.summaryLabel}>Esta semana</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryEarned}>{money(totalEarned)}</Text>
          <Text style={styles.summaryLabel}>Total</Text>
        </View>
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
            {filter === 'completed'
              ? 'Sin servicios completados'
              : filter === 'cancelled'
              ? 'Sin servicios cancelados'
              : 'Sin servicios aun'}
          </Text>
          <Text style={styles.emptyText}>
            {filter === 'all'
              ? 'Los servicios que completes apareceran aqui.'
              : 'No hay servicios en esta categoria.'}
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
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.primary,
    paddingVertical: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  // 4 columnas: usa flex en vez de padding fijo para no desbordar en pantallas angostas.
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    gap: 2,
  },
  summaryValue: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
  },
  summaryEarned: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.success.dark,
  },
  summaryLabel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.micro,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border.light,
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
    marginBottom: spacing.micro,
  },
  clientName: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
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
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.micro,
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
  modalBottomSpacer: {
    height: spacing.xxxl,
  },
});
