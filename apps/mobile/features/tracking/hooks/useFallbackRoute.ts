import { useMemo } from 'react';
import type { LatLng } from '@/lib/geoUtils';

// When no real route is available (Google Directions down, no stored
// polyline, no live operator coords), generate intermediate points
// between a synthetic start and the actual pickup. Used for demo mode
// and as a last-resort visualisation so the map isn't empty.
//
// Offset is hardcoded for El Salvador (~2 km south-west of pickup).
// Move to a region-aware config when expanding to other markets.
const STEPS = 20;
const OFFSET_LAT = -0.015;
const OFFSET_LNG = -0.012;

export function useFallbackRoute(
  pickup: { lat: number; lng: number } | null,
): LatLng[] {
  return useMemo(() => {
    if (!pickup) return [];

    const start = {
      latitude: pickup.lat + OFFSET_LAT,
      longitude: pickup.lng + OFFSET_LNG,
    };
    const target = { latitude: pickup.lat, longitude: pickup.lng };

    const points: LatLng[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      points.push({
        latitude: start.latitude + (target.latitude - start.latitude) * t,
        longitude: start.longitude + (target.longitude - start.longitude) * t,
      });
    }
    return points;
  }, [pickup?.lat, pickup?.lng]);
}
