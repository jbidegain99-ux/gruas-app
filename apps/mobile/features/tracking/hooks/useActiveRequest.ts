import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';

export interface ActiveRequest {
  id: string;
  status: string;
  updated_at: string;
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
}

export interface PendingRating {
  id: string;
  operatorName: string | null;
  completedAt: string;
}

interface UseActiveRequestResult {
  activeRequest: ActiveRequest | null;
  userName: string;
  pendingRatings: PendingRating[];
  setPendingRatings: React.Dispatch<React.SetStateAction<PendingRating[]>>;
  currentUserId: string | null;
  loading: boolean;
  error: boolean;
  refetch: () => Promise<void>;
}

// service_requests columns we always select. route_polyline is appended
// dynamically and stripped on retry if the column doesn't exist (the
// app supports DBs from before migration 00023).
const BASE_SELECT = `
  id,
  status,
  updated_at,
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
  operator:profiles!service_requests_operator_id_fkey (full_name, phone),
  providers (name)
`;

/**
 * Loads the current user's active request (if any) plus the list of
 * recently-completed requests waiting for a rating. Subscribes to
 * service_requests changes via Supabase Realtime and re-fetches on
 * each event. Cleans up the channel on unmount.
 *
 * Used by the user home screen. The fetch and the Realtime channel
 * used to live inline in (user)/index.tsx; collected here so the
 * subscription lifecycle is auditable in one place.
 */
export function useActiveRequest(): UseActiveRequestResult {
  const [activeRequest, setActiveRequest] = useState<ActiveRequest | null>(null);
  // Ultima solicitud que el usuario tiene en pantalla; se usa para detectar
  // transiciones de estado que llegan por Realtime y avisarle in-app
  // (la push del backend no llega en Expo Go).
  const trackedRef = useRef<{ id: string; status: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [userName, setUserName] = useState('');
  const [pendingRatings, setPendingRatings] = useState<PendingRating[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(false);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      // Session not hydrated yet / token expired: clear state but DON'T leave
      // loading=true forever — that freezes the home on <LoadingSpinner fullScreen>.
      setActiveRequest(null);
      setLoading(false);
      return;
    }

    setCurrentUserId(user.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();
    if (profile?.full_name) {
      setUserName(profile.full_name.split(' ')[0]);
    }

    let { data: requests, error: fetchError } = await supabase
      .from('service_requests')
      .select(`${BASE_SELECT}, route_polyline`)
      .eq('user_id', user.id)
      .in('status', ['initiated', 'assigned', 'en_route', 'active'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchError) {
      console.warn('[useActiveRequest] Query with route_polyline failed, retrying without:', fetchError.message);
      const fallback = await supabase
        .from('service_requests')
        .select(BASE_SELECT)
        .eq('user_id', user.id)
        .in('status', ['initiated', 'assigned', 'en_route', 'active'])
        .order('created_at', { ascending: false })
        .limit(1);
      requests = fallback.data as typeof requests;
      fetchError = fallback.error;
    }

    if (fetchError) {
      // Fallo real de red/servidor (no es "sin solicitudes"): lo comunicamos
      // en vez de mostrar la pantalla vacía como si no hubiera nada.
      console.error('[useActiveRequest] Failed to fetch active requests:', fetchError.message);
      setError(true);
      setLoading(false);
      return;
    }

    if (requests && requests.length > 0) {
      const req = requests[0];
      trackedRef.current = { id: req.id, status: req.status };
      setActiveRequest({
        id: req.id,
        status: req.status,
        updated_at: req.updated_at,
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
        operator_name: (req.operator as unknown as { full_name: string; phone: string } | null)?.full_name || null,
        operator_phone: (req.operator as unknown as { full_name: string; phone: string } | null)?.phone || null,
        provider_name: (req.providers as unknown as { name: string } | null)?.name || null,
        service_type: req.service_type || 'tow',
        route_polyline: (req as Record<string, unknown>).route_polyline as string | null ?? null,
      });
    } else {
      trackedRef.current = null;
      setActiveRequest(null);

      // No active request: surface recently-completed requests that
      // haven't been rated yet (within the last 7 days).
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
        console.log('[useActiveRequest] Error checking completed requests:', completedError);
        setPendingRatings([]);
      } else if (completedRequests && completedRequests.length > 0) {
        const requestIds = completedRequests.map((r) => r.id);
        const { data: existingRatings } = await supabase
          .from('ratings')
          .select('request_id')
          .in('request_id', requestIds);

        const ratedIds = new Set(existingRatings?.map((r) => r.request_id) || []);

        const unrated = completedRequests
          .filter((req) => !ratedIds.has(req.id))
          .map((req) => ({
            id: req.id,
            operatorName: (req.operator as unknown as { full_name: string } | null)?.full_name || null,
            completedAt: req.completed_at || '',
          }));

        setPendingRatings(unrated);
      } else {
        setPendingRatings([]);
      }
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      await refetch();
      if (!mounted) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!mounted || !user) return;

      const ch = supabase
        .channel('user-requests')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'service_requests',
            // Only react to THIS user's requests — otherwise every change in
            // the table (any user) would trigger a refetch.
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if (!mounted) return;

            // Aviso in-app cuando la solicitud que el usuario esta viendo
            // cambia de estado "por el otro lado" (operador/admin). La push
            // del backend no llega en Expo Go, y sin esto la UI cambia en
            // silencio y el usuario no entiende que paso.
            const next = payload.new as {
              id?: string;
              status?: string;
              cancelled_by?: string | null;
              cancellation_reason?: string | null;
            } | null;
            const prev = trackedRef.current;
            if (next?.id && prev && next.id === prev.id && next.status && next.status !== prev.status) {
              if (
                next.status === 'initiated' &&
                ['assigned', 'en_route', 'active'].includes(prev.status)
              ) {
                // El operador libero la solicitud: volvio al pool (RPC
                // cancel_service_request, migracion 00035).
                Alert.alert(
                  'Buscando otro operador',
                  'El operador no pudo atender tu servicio. Tu solicitud sigue activa y estamos buscando otro operador.'
                );
              } else if (next.status === 'cancelled' && next.cancelled_by !== user.id) {
                // Cancelacion terminal por admin (u otro actor que no es el usuario).
                Alert.alert(
                  'Servicio cancelado',
                  next.cancellation_reason
                    ? `Tu servicio fue cancelado.\n\nMotivo: ${next.cancellation_reason}`
                    : 'Tu servicio fue cancelado.'
                );
              }
            }

            refetch();
          },
        )
        .subscribe();

      // If the component unmounted while we were awaiting, the cleanup below
      // already ran with channel=null; remove this one so it doesn't leak.
      if (!mounted) {
        supabase.removeChannel(ch);
        return;
      }
      channel = ch;
    };

    init();

    return () => {
      mounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [refetch]);

  return {
    activeRequest,
    userName,
    pendingRatings,
    setPendingRatings,
    currentUserId,
    loading,
    error,
    refetch,
  };
}
