import { useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import { Alert, AppState, AppStateStatus } from 'react-native';

interface UseOperatorLocationTrackingOptions {
  /** Whether tracking should be active */
  isActive: boolean;
  /** Interval between location updates in milliseconds (default: 15000) */
  intervalMs?: number;
  /** Minimum distance change to trigger update in meters (default: 50) */
  distanceInterval?: number;
}

/**
 * Hook to track and send operator location to Supabase
 * when they have an active service (assigned, en_route, or active status)
 */
export function useOperatorLocationTracking({
  isActive,
  intervalMs = 15000,
  distanceInterval = 50,
}: UseOperatorLocationTrackingOptions) {
  const watchSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isTrackingRef = useRef(false);

  // Update location in Supabase
  const updateLocation = useCallback(async (location: Location.LocationObject) => {
    const { latitude, longitude } = location.coords;

    try {
      // Only send parameters that the RPC function expects: p_lat, p_lng, p_is_online
      // If you need heading/speed/accuracy, update the RPC function in Supabase first
      const { error } = await supabase.rpc('upsert_operator_location', {
        p_lat: latitude,
        p_lng: longitude,
        p_is_online: true,
      });

      if (error) {
        console.error('Error updating operator location:', error);
      }
    } catch (err) {
      console.error('Exception updating operator location:', err);
    }
  }, []);

  // Set operator offline
  const setOffline = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('operator_locations')
        .update({ is_online: false, updated_at: new Date().toISOString() })
        .eq('operator_id', user.id);

      if (error) {
        console.error('Error setting operator offline:', error);
      }
    } catch (err) {
      console.error('Exception setting operator offline:', err);
    }
  }, []);

  // Start location tracking
  const startTracking = useCallback(async () => {
    if (isTrackingRef.current) return;

    try {
      // Request foreground permissions
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        Alert.alert(
          'Permiso Requerido',
          'Se necesita acceso a tu ubicación para que los clientes puedan ver tu posición.',
          [{ text: 'OK' }]
        );
        return;
      }

      // Get initial location immediately
      const initialLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      await updateLocation(initialLocation);

      // Start watching position
      watchSubscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: intervalMs,
          distanceInterval: distanceInterval,
        },
        (location) => {
          updateLocation(location);
        }
      );

      isTrackingRef.current = true;
      console.log('Operator location tracking started');
    } catch (err) {
      console.error('Error starting location tracking:', err);
      Alert.alert(
        'Error de Ubicación',
        'No se pudo iniciar el seguimiento de ubicación. Verifica los permisos.',
        [{ text: 'OK' }]
      );
    }
  }, [intervalMs, distanceInterval, updateLocation]);

  // Stop location tracking
  const stopTracking = useCallback(async () => {
    if (watchSubscriptionRef.current) {
      watchSubscriptionRef.current.remove();
      watchSubscriptionRef.current = null;
    }

    if (isTrackingRef.current) {
      await setOffline();
      isTrackingRef.current = false;
      console.log('Operator location tracking stopped');
    }
  }, [setOffline]);

  // Handle app state changes (background/foreground)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App came to foreground
        if (isActive && !isTrackingRef.current) {
          startTracking();
        }
      } else if (
        appStateRef.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        // App went to background - keep tracking if foreground permission
        // (for MVP, we don't use background tracking)
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [isActive, startTracking]);

  // Main effect to start/stop tracking based on isActive
  useEffect(() => {
    if (isActive) {
      startTracking();
    } else {
      stopTracking();
    }

    // Cleanup on unmount
    return () => {
      stopTracking();
    };
  }, [isActive, startTracking, stopTracking]);

  return {
    isTracking: isTrackingRef.current,
  };
}
