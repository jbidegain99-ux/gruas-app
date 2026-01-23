import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

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
};

export default function OperatorRequests() {
  const router = useRouter();
  const [requests, setRequests] = useState<AvailableRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState('');
  const [hasActiveService, setHasActiveService] = useState(false);

  const fetchData = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    // Get operator profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, provider_id')
      .eq('id', user.id)
      .single();

    if (profile?.full_name) {
      setOperatorName(profile.full_name.split(' ')[0]);
    }

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

    // Fetch available requests using RPC
    const { data: availableRequests } = await supabase.rpc('get_available_requests_for_operator', {
      p_operator_id: user.id,
    });

    if (availableRequests) {
      setRequests(availableRequests as AvailableRequest[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();

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

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
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

    // Get operator's provider_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('provider_id')
      .eq('id', user.id)
      .single();

    if (!profile?.provider_id) {
      Alert.alert('Error', 'No tienes un proveedor asignado');
      setAcceptingId(null);
      return;
    }

    // Assign the request to this operator
    const { error } = await supabase
      .from('service_requests')
      .update({
        status: 'assigned',
        operator_id: user.id,
        provider_id: profile.provider_id,
      })
      .eq('id', requestId)
      .eq('status', 'initiated'); // Only if still available

    if (error) {
      Alert.alert('Error', 'No se pudo aceptar la solicitud. Puede que ya haya sido tomada.');
      setAcceptingId(null);
      await fetchData();
      return;
    }

    // Log the event
    await supabase.from('request_events').insert({
      request_id: requestId,
      event_type: 'assigned',
      created_by: user.id,
      metadata: { operator_id: user.id, provider_id: profile.provider_id },
    });

    Alert.alert('Solicitud Aceptada', 'Has aceptado el servicio. Dirígete al lugar de recogida.', [
      {
        text: 'Ver Servicio',
        onPress: () => router.push('/(operator)/active'),
      },
    ]);

    setAcceptingId(null);
    await fetchData();
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);

    if (diffMinutes < 1) return 'Ahora';
    if (diffMinutes < 60) return `Hace ${diffMinutes} min`;

    return date.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
  };

  const renderRequest = ({ item }: { item: AvailableRequest }) => (
    <View style={styles.requestCard}>
      <View style={styles.requestHeader}>
        <View style={styles.towTypeBadge}>
          <Text style={styles.towTypeText}>
            {item.tow_type === 'light' ? 'Liviana' : 'Pesada'}
          </Text>
        </View>
        <Text style={styles.timeText}>{formatTime(item.created_at)}</Text>
      </View>

      <Text style={styles.incidentType}>{item.incident_type}</Text>

      <View style={styles.addressSection}>
        <View style={styles.addressRow}>
          <View style={styles.addressDot} />
          <View style={styles.addressTextContainer}>
            <Text style={styles.addressLabel}>Recogida</Text>
            <Text style={styles.addressText} numberOfLines={2}>
              {item.pickup_address}
            </Text>
          </View>
        </View>
        <View style={styles.addressLine} />
        <View style={styles.addressRow}>
          <View style={[styles.addressDot, styles.destinationDot]} />
          <View style={styles.addressTextContainer}>
            <Text style={styles.addressLabel}>Destino</Text>
            <Text style={styles.addressText} numberOfLines={2}>
              {item.dropoff_address}
            </Text>
          </View>
        </View>
      </View>

      {item.user_name && (
        <Text style={styles.userName}>Cliente: {item.user_name}</Text>
      )}

      <TouchableOpacity
        style={[styles.acceptButton, acceptingId === item.id && styles.acceptButtonDisabled]}
        onPress={() => handleAcceptRequest(item.id)}
        disabled={acceptingId === item.id}
      >
        {acceptingId === item.id ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.acceptButtonText}>Aceptar Servicio</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hola{operatorName ? `, ${operatorName}` : ''}</Text>
        <Text style={styles.subtitle}>
          {hasActiveService
            ? 'Tienes un servicio activo'
            : requests.length > 0
              ? `${requests.length} solicitud${requests.length !== 1 ? 'es' : ''} disponible${requests.length !== 1 ? 's' : ''}`
              : 'No hay solicitudes disponibles'}
        </Text>
      </View>

      {hasActiveService ? (
        <View style={styles.activeServiceCard}>
          <Text style={styles.activeServiceText}>
            Tienes un servicio en curso. Complétalo antes de aceptar uno nuevo.
          </Text>
          <TouchableOpacity
            style={styles.viewActiveButton}
            onPress={() => router.push('/(operator)/active')}
          >
            <Text style={styles.viewActiveButtonText}>Ver Servicio Activo</Text>
          </TouchableOpacity>
        </View>
      ) : requests.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📍</Text>
          <Text style={styles.emptyTitle}>Sin solicitudes</Text>
          <Text style={styles.emptyText}>
            Las nuevas solicitudes aparecerán aquí automáticamente.
          </Text>
        </View>
      ) : (
        <FlatList
          data={requests}
          renderItem={renderRequest}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />
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
    backgroundColor: '#f9fafb',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  header: {
    padding: 20,
    paddingBottom: 12,
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
  listContent: {
    padding: 20,
    paddingTop: 8,
    gap: 16,
  },
  requestCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 12,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  towTypeBadge: {
    backgroundColor: '#f0fdf4',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  towTypeText: {
    color: '#16a34a',
    fontSize: 12,
    fontWeight: '600',
  },
  timeText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  incidentType: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  addressSection: {
    marginBottom: 12,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
  addressLine: {
    width: 2,
    height: 24,
    backgroundColor: '#e5e7eb',
    marginLeft: 5,
    marginVertical: 4,
  },
  addressTextContainer: {
    flex: 1,
  },
  addressLabel: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addressText: {
    fontSize: 14,
    color: '#374151',
    marginTop: 2,
  },
  userName: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 12,
  },
  acceptButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  acceptButtonDisabled: {
    opacity: 0.7,
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  activeServiceCard: {
    margin: 20,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#16a34a',
    alignItems: 'center',
  },
  activeServiceText: {
    fontSize: 15,
    color: '#374151',
    textAlign: 'center',
    marginBottom: 16,
  },
  viewActiveButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  viewActiveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyState: {
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
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
  },
});
