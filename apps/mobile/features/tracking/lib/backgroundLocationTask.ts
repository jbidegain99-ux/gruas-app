/**
 * Tracking de ubicación en segundo plano del operador.
 *
 * Complementa a `useOperatorLocationTracking` (que usa `watchPositionAsync` y
 * sólo corre en primer plano): con esto la grúa sigue transmitiendo con la app
 * minimizada o la pantalla bloqueada, que es lo que pasa cuando el operador
 * está conduciendo.
 *
 * IMPORTANTE: la ubicación en segundo plano **no funciona en Expo Go** — hace
 * falta un development build. Todas las funciones de acá degradan a no-op
 * cuando no está soportado, para que Expo Go siga funcionando con el tracking
 * de primer plano y sin errores.
 */
import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { supabase } from '@/lib/supabase';
import { DEMO_CONFIG } from '@/config/demo';

export const BG_LOCATION_TASK = 'budi-operator-location';

/**
 * Sólo hay background location en un build nativo propio: ni en web ni en
 * Expo Go (que no trae el módulo nativo).
 */
export function isBackgroundLocationSupported(): boolean {
  if (Platform.OS === 'web') return false;
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

// `defineTask` debe ejecutarse al cargar el módulo, antes de que el sistema
// pueda entregar ubicaciones. Se importa desde `app/_layout.tsx`.
if (isBackgroundLocationSupported()) {
  TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.error('[BgLocation] Error en la tarea:', error.message);
      return;
    }
    const { locations } = (data || {}) as { locations?: Location.LocationObject[] };
    const location = locations?.[locations.length - 1];
    if (!location) return;

    // La tarea puede correr en un contexto JS recién arrancado: sin sesión
    // restaurada, el RPC entra como anónimo y RLS lo rechaza.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.warn('[BgLocation] Sin sesión activa; se descarta la posición.');
      return;
    }

    const { error: rpcError } = await supabase.rpc('upsert_operator_location', {
      p_lat: location.coords.latitude,
      p_lng: location.coords.longitude,
      p_is_online: true,
    });

    if (rpcError) {
      console.error('[BgLocation] Error al enviar la ubicación:', rpcError.message);
    }
  });
}

/**
 * Arranca el tracking en segundo plano. Devuelve false (sin lanzar) si no está
 * soportado o si el usuario no concedió el permiso "siempre" — el llamador
 * sigue con el tracking de primer plano igual.
 */
export async function startBackgroundTracking(): Promise<boolean> {
  if (DEMO_CONFIG.ENABLED) return false;
  if (!isBackgroundLocationSupported()) {
    console.log('[BgLocation] No soportado en Expo Go; sólo primer plano.');
    return false;
  }

  try {
    // El permiso de background exige tener antes el de foreground.
    const foreground = await Location.getForegroundPermissionsAsync();
    if (foreground.status !== 'granted') return false;

    const { status } = await Location.requestBackgroundPermissionsAsync();
    if (status !== 'granted') {
      console.log('[BgLocation] Permiso "siempre" denegado; sólo primer plano.');
      return false;
    }

    if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)) return true;

    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15000,
      distanceInterval: 50,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Budi — transmitiendo ubicación',
        notificationBody: 'El Usuario puede ver dónde estás.',
        notificationColor: '#2D5F8B',
      },
    });
    console.log('[BgLocation] Tracking en segundo plano iniciado.');
    return true;
  } catch (err) {
    // Nunca romper el tracking de primer plano por esto.
    console.warn('[BgLocation] No se pudo iniciar:', err);
    return false;
  }
}

/** Detiene el tracking en segundo plano (idempotente y seguro de llamar siempre). */
export async function stopBackgroundTracking(): Promise<void> {
  if (!isBackgroundLocationSupported()) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
      console.log('[BgLocation] Tracking en segundo plano detenido.');
    }
  } catch (err) {
    console.warn('[BgLocation] No se pudo detener:', err);
  }
}
