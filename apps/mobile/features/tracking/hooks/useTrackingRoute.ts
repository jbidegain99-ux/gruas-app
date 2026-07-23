import { useMemo } from 'react';
import { decodePolyline } from '@/lib/geoUtils';
import type { LatLng } from '@/lib/geoUtils';
import { useFallbackRoute } from './useFallbackRoute';

interface TrackingRouteInput {
  pickup: { lat: number; lng: number } | null;
  storedPolyline: string | null;
  etaPolyline: string | null;
  operatorLocation: { lat: number; lng: number; is_online: boolean } | null;
  isDemoMode: boolean;
}

interface TrackingRouteOutput {
  /** Best available route to feed the GPS simulator (demo mode). */
  simulationRoute: LatLng[];
  /** Best available route to draw on the map for the user. */
  routeCoordinatesForMap: LatLng[];
  /**
   * True iff we have an actual polyline (DB-stored or just-computed ETA),
   * vs. a synthetic straight line. Drives the "estimated" badge on the map.
   */
  hasRealRoute: boolean;
}

/**
 * Single source of truth for "which polyline do we show on the user's
 * tracking map." Was scattered across four useMemos plus an inline
 * branch tree in (user)/index.tsx. Order of preference:
 *
 *   simulationRoute:
 *     1. DB-stored polyline (operator already accepted and saved one)
 *     2. ETA polyline (just computed from Google Directions)
 *     3. Demo fallback (synthetic line through pickup)
 *
 *   routeCoordinatesForMap:
 *     1. Active simulation route (demo mode)
 *     2. Stored polyline
 *     3. ETA polyline (decoded; if stored is empty)
 *     4. Straight line operator -> pickup (when operator online but no
 *        polyline anywhere)
 *     5. Empty (no map line at all)
 */
export function useTrackingRoute({
  pickup,
  storedPolyline,
  etaPolyline,
  operatorLocation,
  isDemoMode,
}: TrackingRouteInput): TrackingRouteOutput {
  const decodedStoredRoute = useMemo(
    () => (storedPolyline ? decodePolyline(storedPolyline) : []),
    [storedPolyline],
  );

  const decodedEtaRoute = useMemo(
    () => (etaPolyline ? decodePolyline(etaPolyline) : []),
    [etaPolyline],
  );

  const fallbackRoute = useFallbackRoute(pickup);

  const simulationRoute = useMemo<LatLng[]>(() => {
    if (decodedStoredRoute.length >= 2) return decodedStoredRoute;
    if (decodedEtaRoute.length >= 2) return decodedEtaRoute;
    if (isDemoMode && fallbackRoute.length >= 2) return fallbackRoute;
    return [];
  }, [decodedStoredRoute, decodedEtaRoute, isDemoMode, fallbackRoute]);

  const hasRealRoute =
    decodedStoredRoute.length >= 2 ||
    decodedEtaRoute.length >= 2 ||
    !!etaPolyline;

  const routeCoordinatesForMap = useMemo<LatLng[]>(() => {
    if (isDemoMode && simulationRoute.length >= 2) return simulationRoute;
    if (decodedStoredRoute.length >= 2) return decodedStoredRoute;
    if (decodedEtaRoute.length >= 2) return decodedEtaRoute;
    if (operatorLocation?.is_online && pickup) {
      return [
        { latitude: operatorLocation.lat, longitude: operatorLocation.lng },
        { latitude: pickup.lat, longitude: pickup.lng },
      ];
    }
    return [];
  }, [
    isDemoMode,
    simulationRoute,
    decodedStoredRoute,
    decodedEtaRoute,
    operatorLocation?.lat,
    operatorLocation?.lng,
    operatorLocation?.is_online,
    pickup?.lat,
    pickup?.lng,
  ]);

  return { simulationRoute, routeCoordinatesForMap, hasRealRoute };
}
