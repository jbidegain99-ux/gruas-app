import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

type ActiveRequest = {
  id: string;
  status: string;
  tow_type: string;
  incident_type: string;
  pickup_address: string;
  dropoff_address: string;
  total_price: number | null;
  created_at: string;
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

  const fetchActiveRequest = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

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
        dropoff_address,
        total_price,
        created_at,
        verification_pin,
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
        dropoff_address: req.dropoff_address,
        total_price: req.total_price,
        created_at: req.created_at,
        verification_pin: req.verification_pin,
        operator_name: (req.operator as unknown as { full_name: string } | null)?.full_name || null,
        provider_name: (req.providers as unknown as { name: string } | null)?.name || null,
      });
    } else {
      setActiveRequest(null);
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
});
