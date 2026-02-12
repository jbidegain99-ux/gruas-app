import { useState, useEffect, useRef, useCallback } from 'react';
import { DEMO_CONFIG } from '@/config/demo';
import { haversineDistance } from '@/lib/geoUtils';
import type { LatLng } from '@/lib/geoUtils';

interface SimulatorConfig {
  /** Decoded polyline route points */
  route: LatLng[];
  /** Whether simulation is enabled */
  enabled: boolean;
  /** Speed in km/h (defaults to DEMO_CONFIG.AVERAGE_SPEED_KMH) */
  speedKmh?: number;
}

interface SimulatorState {
  /** Current simulated position along route */
  currentPosition: LatLng | null;
  /** Remaining distance in km */
  remainingDistanceKm: number;
  /** Estimated time of arrival in minutes */
  etaMinutes: number;
  /** Progress from 0 to 1 */
  progress: number;
  /** Whether operator has arrived at destination */
  isComplete: boolean;
  /** Current heading in degrees (for marker rotation) */
  heading: number;
}

/**
 * Calculate total distance of a polyline route in km
 */
function calculateRouteDistance(route: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += haversineDistance(
      route[i - 1].latitude,
      route[i - 1].longitude,
      route[i].latitude,
      route[i].longitude
    );
  }
  return total;
}

/**
 * Calculate bearing between two points in degrees (0-360)
 */
function calculateBearing(from: LatLng, to: LatLng): number {
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Interpolate between two LatLng points by a fraction (0-1)
 */
function interpolatePosition(from: LatLng, to: LatLng, fraction: number): LatLng {
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * fraction,
    longitude: from.longitude + (to.longitude - from.longitude) * fraction,
  };
}

/**
 * Hook that simulates GPS movement along a polyline route.
 * Used in demo/dev mode to make operator appear to move realistically.
 */
export function useGPSSimulator(config: SimulatorConfig): SimulatorState {
  const { route, enabled, speedKmh = DEMO_CONFIG.AVERAGE_SPEED_KMH } = config;

  const [state, setState] = useState<SimulatorState>({
    currentPosition: null,
    remainingDistanceKm: 0,
    etaMinutes: 0,
    progress: 0,
    isComplete: false,
    heading: 0,
  });

  // Track cumulative distance traveled along the route
  const distanceTraveledRef = useRef(0);
  const totalDistanceRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Given a distance traveled along the route, find the position on the polyline.
   */
  const getPositionAtDistance = useCallback(
    (distanceTraveled: number): { position: LatLng; segmentIndex: number } | null => {
      if (route.length < 2) return null;

      let accumulated = 0;
      for (let i = 1; i < route.length; i++) {
        const segmentLength = haversineDistance(
          route[i - 1].latitude,
          route[i - 1].longitude,
          route[i].latitude,
          route[i].longitude
        );

        if (accumulated + segmentLength >= distanceTraveled) {
          // Position is within this segment
          const remainingInSegment = distanceTraveled - accumulated;
          const fraction = segmentLength > 0 ? remainingInSegment / segmentLength : 0;
          return {
            position: interpolatePosition(route[i - 1], route[i], fraction),
            segmentIndex: i,
          };
        }
        accumulated += segmentLength;
      }

      // Past the end — return last point
      return {
        position: route[route.length - 1],
        segmentIndex: route.length - 1,
      };
    },
    [route]
  );

  // Reset when route changes
  useEffect(() => {
    if (!enabled || route.length < 2) {
      setState({
        currentPosition: null,
        remainingDistanceKm: 0,
        etaMinutes: 0,
        progress: 0,
        isComplete: false,
        heading: 0,
      });
      distanceTraveledRef.current = 0;
      totalDistanceRef.current = 0;
      return;
    }

    const totalDist = calculateRouteDistance(route);
    totalDistanceRef.current = totalDist;
    distanceTraveledRef.current = 0;

    const etaMin = Math.max(1, Math.round((totalDist / speedKmh) * 60));

    setState({
      currentPosition: route[0],
      remainingDistanceKm: totalDist,
      etaMinutes: etaMin,
      progress: 0,
      isComplete: false,
      heading: calculateBearing(route[0], route[1]),
    });
  }, [enabled, route, speedKmh]);

  // Movement simulation loop
  useEffect(() => {
    if (!enabled || route.length < 2) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      // Distance traveled per tick: speed (km/h) * time (h) * simulation speed
      const intervalSeconds = DEMO_CONFIG.UPDATE_INTERVAL_MS / 1000;
      const distancePerTick =
        (speedKmh / 3600) * intervalSeconds * DEMO_CONFIG.SIMULATION_SPEED;

      distanceTraveledRef.current += distancePerTick;
      const totalDist = totalDistanceRef.current;

      // Check completion
      if (distanceTraveledRef.current >= totalDist) {
        distanceTraveledRef.current = totalDist;
        const lastPoint = route[route.length - 1];

        setState({
          currentPosition: lastPoint,
          remainingDistanceKm: 0,
          etaMinutes: 0,
          progress: 1,
          isComplete: true,
          heading: route.length >= 2
            ? calculateBearing(route[route.length - 2], lastPoint)
            : 0,
        });

        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }

      const result = getPositionAtDistance(distanceTraveledRef.current);
      if (!result) return;

      const remaining = totalDist - distanceTraveledRef.current;
      const etaMin = Math.max(1, Math.round((remaining / speedKmh) * 60));
      const progress = totalDist > 0 ? distanceTraveledRef.current / totalDist : 0;

      // Calculate heading from current segment
      const heading =
        result.segmentIndex > 0
          ? calculateBearing(route[result.segmentIndex - 1], route[result.segmentIndex])
          : 0;

      setState({
        currentPosition: result.position,
        remainingDistanceKm: Math.round(remaining * 10) / 10,
        etaMinutes: etaMin,
        progress,
        isComplete: false,
        heading,
      });
    }, DEMO_CONFIG.UPDATE_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, route, speedKmh, getPositionAtDistance]);

  return state;
}
