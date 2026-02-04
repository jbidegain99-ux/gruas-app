import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface OperatorLocation {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  updated_at: string;
  is_online: boolean;
}

interface UseOperatorRealtimeTrackingResult {
  location: OperatorLocation | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refetch: () => void;
}

/**
 * Hook to track an operator's real-time location via Supabase Realtime
 * Used by customers to see their assigned operator on the map
 */
export function useOperatorRealtimeTracking(
  operatorId: string | null
): UseOperatorRealtimeTrackingResult {
  const [location, setLocation] = useState<OperatorLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Fetch initial location
  const fetchLocation = useCallback(async () => {
    if (!operatorId) {
      setLocation(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('operator_locations')
        .select('lat, lng, heading, speed, updated_at, is_online')
        .eq('operator_id', operatorId)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          // No rows returned - operator hasn't sent location yet
          setLocation(null);
          setError(null);
        } else {
          console.error('Error fetching operator location:', fetchError);
          setError('No se pudo obtener la ubicación del operador');
        }
      } else if (data) {
        setLocation({
          lat: data.lat,
          lng: data.lng,
          heading: data.heading,
          speed: data.speed,
          updated_at: data.updated_at,
          is_online: data.is_online,
        });
        setLastUpdated(new Date(data.updated_at));
      }
    } catch (err) {
      console.error('Exception fetching operator location:', err);
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [operatorId]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!operatorId) {
      setLocation(null);
      return;
    }

    // Fetch initial location
    fetchLocation();

    // Subscribe to real-time changes
    const channel = supabase
      .channel(`operator-location-${operatorId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT and UPDATE
          schema: 'public',
          table: 'operator_locations',
          filter: `operator_id=eq.${operatorId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setLocation(null);
            return;
          }

          const newData = payload.new as {
            lat: number;
            lng: number;
            heading: number | null;
            speed: number | null;
            updated_at: string;
            is_online: boolean;
          };

          setLocation({
            lat: newData.lat,
            lng: newData.lng,
            heading: newData.heading,
            speed: newData.speed,
            updated_at: newData.updated_at,
            is_online: newData.is_online,
          });
          setLastUpdated(new Date(newData.updated_at));
          setError(null);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Subscribed to operator location updates');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Error subscribing to operator location');
          setError('Error al conectar con el servidor');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [operatorId, fetchLocation]);

  return {
    location,
    loading,
    error,
    lastUpdated,
    refetch: fetchLocation,
  };
}
