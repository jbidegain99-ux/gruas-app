import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { MovementThrottle } from '@/lib/geoUtils';

interface Coordinates {
  lat: number;
  lng: number;
}

interface ETAResult {
  etaMinutes: number;
  etaText: string;
  distanceKm: number;
  distanceText: string;
  isFallback: boolean;
  overviewPolyline: string | null;
}

interface UseETAResult {
  eta: ETAResult | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refetch: () => void;
}

// Throttle: only update if operator moved more than 100 meters
const movementThrottle = new MovementThrottle(0.1);

// Update interval: 60 seconds
const UPDATE_INTERVAL_MS = 60 * 1000;

/**
 * Hook to fetch and maintain ETA with traffic data
 * Updates every 60 seconds, but only if operator has moved >100m
 */
export function useETA(
  operatorLocation: Coordinates | null,
  destinationLocation: Coordinates | null,
  enabled: boolean = true
): UseETAResult {
  const [eta, setEta] = useState<ETAResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchedPositionRef = useRef<Coordinates | null>(null);

  const fetchETA = useCallback(async (forceUpdate: boolean = false) => {
    if (!operatorLocation || !destinationLocation || !enabled) {
      return;
    }

    // Check if operator has moved enough to warrant a new ETA calculation
    if (!forceUpdate && lastFetchedPositionRef.current) {
      const shouldUpdate = movementThrottle.shouldUpdate(
        operatorLocation.lat,
        operatorLocation.lng
      );

      if (!shouldUpdate) {
        console.log('[ETA] Skipping update - operator has not moved enough');
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('get-eta', {
        body: {
          operator_lat: operatorLocation.lat,
          operator_lng: operatorLocation.lng,
          destination_lat: destinationLocation.lat,
          destination_lng: destinationLocation.lng,
        },
      });

      if (fnError) {
        console.error('[ETA] Edge function error:', fnError);
        setError('No se pudo calcular el tiempo estimado');
        setLoading(false);
        return;
      }

      if (!data.success) {
        setError(data.error || 'Error al calcular ETA');
        setLoading(false);
        return;
      }

      const result: ETAResult = {
        etaMinutes: data.eta_minutes,
        etaText: data.eta_text,
        distanceKm: data.distance_km,
        distanceText: data.distance_text,
        isFallback: data.is_fallback || false,
        overviewPolyline: data.overview_polyline || null,
      };

      setEta(result);
      setLastUpdated(new Date());
      lastFetchedPositionRef.current = { ...operatorLocation };
      console.log('[ETA] Updated:', result);
    } catch (err) {
      console.error('[ETA] Error:', err);
      setError('Error de conexion');
    } finally {
      setLoading(false);
    }
  }, [operatorLocation, destinationLocation, enabled]);

  // Initial fetch and periodic updates
  useEffect(() => {
    if (!enabled || !operatorLocation || !destinationLocation) {
      // Clear ETA when disabled or missing coordinates
      setEta(null);
      setError(null);
      movementThrottle.reset();
      lastFetchedPositionRef.current = null;

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial fetch
    fetchETA(true);

    // Set up periodic updates
    intervalRef.current = setInterval(() => {
      fetchETA(false);
    }, UPDATE_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, operatorLocation?.lat, operatorLocation?.lng, destinationLocation?.lat, destinationLocation?.lng, fetchETA]);

  // Refetch on operator location change (with throttle)
  useEffect(() => {
    if (!enabled || !operatorLocation || !destinationLocation) {
      return;
    }

    // The throttle check happens inside fetchETA
    fetchETA(false);
  }, [operatorLocation?.lat, operatorLocation?.lng, enabled, fetchETA]);

  const refetch = useCallback(() => {
    // Force refetch regardless of movement
    movementThrottle.reset();
    fetchETA(true);
  }, [fetchETA]);

  return {
    eta,
    loading,
    error,
    lastUpdated,
    refetch,
  };
}
