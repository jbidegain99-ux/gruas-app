import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Alert,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Zap, ClipboardList, Truck } from 'lucide-react-native';
import { SERVICE_ICONS } from '@/lib/serviceIcons';
import { supabase } from '@/lib/supabase';
import { SERVICE_TYPE_CONFIGS } from '@gruas-app/shared';
import type { ServiceType } from '@gruas-app/shared';
import { BudiLogo, Button, Card, LoadingSpinner } from '@/components/ui';
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

    // Fetch available requests using RPC (uses auth.uid() internally)
    const { data: availableRequests, error: rpcError } = await supabase.rpc('get_available_requests_for_operator');

    if (rpcError) {
      console.error('Error fetching available requests:', rpcError);
    }

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

    // Note: Audit event is logged automatically by DB trigger on status change

    Alert.alert('Solicitud Aceptada', 'Has aceptado el servicio. Dirigete al lugar de recogida.', [
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

  const renderRequest = ({ item }: { item: AvailableRequest }) => {
    const svcConfig = SERVICE_TYPE_CONFIGS[(item.service_type || 'tow') as ServiceType];
    const isTow = !item.service_type || item.service_type === 'tow';

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
              <Text style={styles.addressText} numberOfLines={2}>
                {item.pickup_address}
              </Text>
            </View>
          </View>
          {isTow && (
            <>
              <View style={styles.addressLine} />
              <View style={styles.addressRow}>
                <MapPin size={14} color={colors.error.main} strokeWidth={2} />
                <View style={styles.addressTextContainer}>
                  <Text style={styles.addressLabel}>Destino</Text>
                  <Text style={styles.addressText} numberOfLines={2}>
                    {item.dropoff_address}
                  </Text>
                </View>
              </View>
            </>
          )}
          {!isTow && (
            <Text style={styles.pickupOnlyText}>Solo recogida</Text>
          )}
        </View>

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
          onPress={() => handleAcceptRequest(item.id)}
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
            : requests.length > 0
              ? `${requests.length} solicitud${requests.length !== 1 ? 'es' : ''} disponible${requests.length !== 1 ? 's' : ''}`
              : 'No hay solicitudes disponibles'}
        </Text>
      </View>

      {hasActiveService ? (
        <View style={styles.activeServiceWrapper}>
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
        </View>
      ) : requests.length === 0 ? (
        <View style={styles.emptyState}>
          <ClipboardList size={56} color={colors.text.tertiary} strokeWidth={1.5} />
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
});
