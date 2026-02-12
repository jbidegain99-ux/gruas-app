import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { MovementThrottle } from '@/lib/geoUtils';

interface Coordinates {
  lat: number;
  lng: number;
}

// Haversine formula for local fallback ETA calculation
function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1.3; // 1.3 factor to approximate road distance
}

function calculateLocalFallback(
  operator: Coordinates,
  destination: Coordinates
): ETAResult {
  const distanceKm = haversineDistanceKm(operator.lat, operator.lng, destination.lat, destination.lng);
  const etaMinutes = Math.max(1, Math.round((distanceKm / 25) * 60)); // 25 km/h urban avg
  return {
    etaMinutes,
    etaText: `~${etaMinutes} min`,
    distanceKm: Math.round(distanceKm * 10) / 10,
    distanceText: `~${Math.round(distanceKm)} km`,
    isFallback: true,
    overviewPolyline: null,
  };
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

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchedPositionRef = useRef<Coordinates | null>(null);
  const fallbackLoggedRef = useRef(false);

  // Use refs so fetchETA always reads the latest values without needing
  // them in its dependency array (prevents infinite re-creation).
  const operatorRef = useRef(operatorLocation);
  operatorRef.current = operatorLocation;
  const destinationRef = useRef(destinationLocation);
  destinationRef.current = destinationLocation;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const fetchETA = useCallback(async (forceUpdate: boolean = false) => {
    const op = operatorRef.current;
    const dest = destinationRef.current;
    if (!op || !dest || !enabledRef.current) {
      return;
    }

    // Check if operator has moved enough to warrant a new ETA calculation
    if (!forceUpdate && lastFetchedPositionRef.current) {
      const shouldUpdate = movementThrottle.shouldUpdate(op.lat, op.lng);

      if (!shouldUpdate) {
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('get-eta', {
        body: {
          operator_lat: op.lat,
          operator_lng: op.lng,
          destination_lat: dest.lat,
          destination_lng: dest.lng,
        },
      });

      if (fnError) {
        if (!fallbackLoggedRef.current) {
          console.warn('[ETA] Edge function unavailable, using local fallback');
          fallbackLoggedRef.current = true;
        }
        const fallback = calculateLocalFallback(op, dest);
        setEta(fallback);
        setLastUpdated(new Date());
        lastFetchedPositionRef.current = { ...op };
        setLoading(false);
        return;
      }

      if (!data.success) {
        if (!fallbackLoggedRef.current) {
          console.warn('[ETA] Edge function returned error, using local fallback');
          fallbackLoggedRef.current = true;
        }
        const fallback = calculateLocalFallback(op, dest);
        setEta(fallback);
        setLastUpdated(new Date());
        lastFetchedPositionRef.current = { ...op };
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
      lastFetchedPositionRef.current = { ...op };
      console.log('[ETA] Updated:', result);
    } catch (err) {
      if (!fallbackLoggedRef.current) {
        console.warn('[ETA] Connection error, using local fallback');
        fallbackLoggedRef.current = true;
      }
      const op2 = operatorRef.current;
      const dest2 = destinationRef.current;
      if (op2 && dest2) {
        const fallback = calculateLocalFallback(op2, dest2);
        setEta(fallback);
        setLastUpdated(new Date());
        lastFetchedPositionRef.current = { ...op2 };
      }
    } finally {
      setLoading(false);
    }
  }, []); // Stable — reads latest values from refs

  // Extract primitive values for stable effect dependencies
  const opLat = operatorLocation?.lat;
  const opLng = operatorLocation?.lng;
  const destLat = destinationLocation?.lat;
  const destLng = destinationLocation?.lng;

  // Initial fetch, periodic updates, and refetch on significant location change
  useEffect(() => {
    if (!enabled || opLat == null || opLng == null || destLat == null || destLng == null) {
      // Clear ETA when disabled or missing coordinates
      setEta(null);
      setError(null);
      movementThrottle.reset();
      lastFetchedPositionRef.current = null;
      fallbackLoggedRef.current = false;

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
  }, [enabled, opLat, opLng, destLat, destLng, fetchETA]);

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
