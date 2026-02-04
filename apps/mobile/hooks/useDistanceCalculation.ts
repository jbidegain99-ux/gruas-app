import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface Coordinates {
  lat: number;
  lng: number;
}

interface DistanceResult {
  distance_km: number;
  distance_text: string;
  duration_minutes: number;
  duration_text: string;
  is_fallback?: boolean;
}

interface UseDistanceCalculationResult {
  distance: number | null;
  distanceText: string | null;
  duration: number | null;
  durationText: string | null;
  loading: boolean;
  error: string | null;
  isFallback: boolean;
  refetch: () => void;
}

// Cache key generator
function getCacheKey(origin: Coordinates | null, destination: Coordinates | null): string | null {
  if (!origin || !destination) return null;
  // Round to 4 decimal places to allow for small GPS variations
  return `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}-${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
}

// Simple in-memory cache
const distanceCache = new Map<string, DistanceResult>();

export function useDistanceCalculation(
  originCoords: Coordinates | null,
  destCoords: Coordinates | null,
  debounceMs: number = 500
): UseDistanceCalculationResult {
  const [distance, setDistance] = useState<number | null>(null);
  const [distanceText, setDistanceText] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [durationText, setDurationText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(false);

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCacheKeyRef = useRef<string | null>(null);

  const calculateDistance = useCallback(async () => {
    if (!originCoords || !destCoords) {
      setDistance(null);
      setDistanceText(null);
      setDuration(null);
      setDurationText(null);
      setError(null);
      setIsFallback(false);
      return;
    }

    const cacheKey = getCacheKey(originCoords, destCoords);

    // Check cache first
    if (cacheKey && distanceCache.has(cacheKey)) {
      const cached = distanceCache.get(cacheKey)!;
      setDistance(cached.distance_km);
      setDistanceText(cached.distance_text);
      setDuration(cached.duration_minutes);
      setDurationText(cached.duration_text);
      setIsFallback(cached.is_fallback || false);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = {
        origin_lat: originCoords.lat,
        origin_lng: originCoords.lng,
        destination_lat: destCoords.lat,
        destination_lng: destCoords.lng,
      };

      console.log('Calling calculate-distance with:', JSON.stringify(payload));

      const { data, error: fnError } = await supabase.functions.invoke('calculate-distance', {
        body: payload,
      });

      console.log('Edge function response:', JSON.stringify(data), 'Error:', fnError);

      if (fnError) {
        console.error('Edge function error:', fnError);
        // Try to get error details
        if (fnError.context) {
          console.error('Error context:', JSON.stringify(fnError.context));
        }
        setError('No se pudo calcular la distancia. Intenta de nuevo.');
        setLoading(false);
        return;
      }

      if (!data.success) {
        setError(data.error || 'Error al calcular distancia');
        setLoading(false);
        return;
      }

      const result: DistanceResult = {
        distance_km: data.distance_km,
        distance_text: data.distance_text,
        duration_minutes: data.duration_minutes,
        duration_text: data.duration_text,
        is_fallback: data.is_fallback,
      };

      // Cache the result
      if (cacheKey) {
        distanceCache.set(cacheKey, result);
        lastCacheKeyRef.current = cacheKey;
      }

      setDistance(result.distance_km);
      setDistanceText(result.distance_text);
      setDuration(result.duration_minutes);
      setDurationText(result.duration_text);
      setIsFallback(result.is_fallback || false);
      setError(null);
    } catch (err) {
      console.error('Distance calculation error:', err);
      setError('Error de conexion. Verifica tu internet.');
    } finally {
      setLoading(false);
    }
  }, [originCoords, destCoords]);

  // Debounced effect
  useEffect(() => {
    // Clear any existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Check if coordinates have actually changed
    const newCacheKey = getCacheKey(originCoords, destCoords);
    if (newCacheKey === lastCacheKeyRef.current) {
      // Coordinates haven't changed meaningfully, skip
      return;
    }

    // If no coordinates, clear results immediately
    if (!originCoords || !destCoords) {
      setDistance(null);
      setDistanceText(null);
      setDuration(null);
      setDurationText(null);
      setError(null);
      setIsFallback(false);
      setLoading(false);
      return;
    }

    // Check cache immediately (no debounce needed for cached results)
    if (newCacheKey && distanceCache.has(newCacheKey)) {
      calculateDistance();
      return;
    }

    // Debounce the API call
    setLoading(true);
    debounceTimeoutRef.current = setTimeout(() => {
      calculateDistance();
    }, debounceMs);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [originCoords, destCoords, debounceMs, calculateDistance]);

  const refetch = useCallback(() => {
    // Clear cache for current key
    const cacheKey = getCacheKey(originCoords, destCoords);
    if (cacheKey) {
      distanceCache.delete(cacheKey);
    }
    calculateDistance();
  }, [originCoords, destCoords, calculateDistance]);

  return {
    distance,
    distanceText,
    duration,
    durationText,
    loading,
    error,
    isFallback,
    refetch,
  };
}
