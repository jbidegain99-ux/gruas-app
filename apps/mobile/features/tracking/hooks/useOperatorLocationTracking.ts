import { useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { AppState, AppStateStatus } from 'react-native';
import { toast } from '@/shared/components/ui';
import { DEMO_CONFIG } from '@/config/demo';
import {
  startBackgroundTracking,
  stopBackgroundTracking,
} from '@/features/tracking/lib/backgroundLocationTask';

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
// En web, expo-location no implementa removeSubscription: `remove()` lanzaba y
// el error dejaba la pantalla del socio tapada justo después de aceptar.
function safeRemove(sub: { remove: () => void } | null | undefined): void {
  try {
    sub?.remove();
  } catch {
    // Sin suscripción real que liberar (web).
  }
}

export function useOperatorLocationTracking({
  isActive,
  intervalMs = 15000,
  distanceInterval = 50,
}: UseOperatorLocationTrackingOptions) {
  const watchSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isTrackingRef = useRef(false);
  // Set when tracking should abort (isActive flipped off / unmount) so a
  // startTracking() still resolving its awaits can bail and clean up instead
  // of installing a GPS watcher that nobody will ever stop.
  const cancelTrackingRef = useRef(false);

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
    if (DEMO_CONFIG.ENABLED) return;

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

    // In demo mode, skip real GPS tracking and Supabase updates entirely
    if (DEMO_CONFIG.ENABLED) {
      logger.log('[LocationTracking] Demo mode active — skipping real tracking');
      return;
    }

    // Mark intent BEFORE any await (so the guard above and stopTracking() both
    // see a start is in progress) and clear any stale abort flag.
    cancelTrackingRef.current = false;
    isTrackingRef.current = true;

    try {
      // Request foreground permissions
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        isTrackingRef.current = false;
        toast.error(
          'Permite el acceso a tu ubicación para que los Usuarios puedan ver tu posición.',
          'Permiso requerido'
        );
        return;
      }
      if (cancelTrackingRef.current) {
        isTrackingRef.current = false;
        return;
      }

      // Get initial location immediately
      const initialLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (cancelTrackingRef.current) {
        isTrackingRef.current = false;
        return;
      }
      await updateLocation(initialLocation);
      if (cancelTrackingRef.current) {
        isTrackingRef.current = false;
        return;
      }

      // Start watching position
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: intervalMs,
          distanceInterval: distanceInterval,
        },
        (location) => {
          updateLocation(location);
        }
      );

      // If tracking was cancelled while the watcher was being created, tear it
      // down now — otherwise it leaks and keeps the operator "online" forever.
      if (cancelTrackingRef.current) {
        safeRemove(subscription);
        isTrackingRef.current = false;
        return;
      }

      watchSubscriptionRef.current = subscription;
      logger.log('Operator location tracking started');

      // Segundo plano: complementa al watcher para que la ubicación siga
      // fluyendo con la app minimizada. Best-effort — en Expo Go o sin permiso
      // "siempre" devuelve false y nos quedamos sólo con el primer plano.
      startBackgroundTracking();
    } catch (err) {
      isTrackingRef.current = false;
      console.error('Error starting location tracking:', err);
      toast.error(
        'No se pudo iniciar el seguimiento de ubicación. Verifica los permisos.',
        'Error de ubicación'
      );
    }
  }, [intervalMs, distanceInterval, updateLocation]);

  // Stop location tracking
  const stopTracking = useCallback(async () => {
    // Abort any startTracking() still mid-await so it cleans up its own watcher
    // instead of installing one after we've already stopped.
    cancelTrackingRef.current = true;

    if (watchSubscriptionRef.current) {
      safeRemove(watchSubscriptionRef.current);
      watchSubscriptionRef.current = null;
    }

    // Siempre, aunque el watcher de primer plano ya no exista: si quedó una
    // tarea de fondo viva seguiría transmitiendo y drenando batería.
    await stopBackgroundTracking();

    if (isTrackingRef.current) {
      isTrackingRef.current = false;
      await setOffline();
      logger.log('Operator location tracking stopped');
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
        // App en segundo plano: no se detiene nada. Si hay development build y
        // permiso "siempre", `startBackgroundTracking` ya dejó corriendo la
        // tarea de fondo, que toma el relevo del watcher de primer plano.
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
