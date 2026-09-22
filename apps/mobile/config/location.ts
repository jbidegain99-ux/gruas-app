/**
 * Default location configuration.
 *
 * Fallback coordinates used when the device hasn't resolved a real
 * position yet (map initial region, request payload when GPS is missing).
 * Centralised here so the San Salvador literals aren't scattered across
 * screens. Override per environment via EXPO_PUBLIC_DEFAULT_* without a
 * code change.
 */

function num(value: string | undefined, fallback: number): number {
  const parsed = value !== undefined ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Default latitude/longitude. Defaults to San Salvador, El Salvador. */
export const DEFAULT_LOCATION = {
  latitude: num(process.env.EXPO_PUBLIC_DEFAULT_LAT, 13.6929),
  longitude: num(process.env.EXPO_PUBLIC_DEFAULT_LNG, -89.2182),
} as const;

/** Default map zoom span around DEFAULT_LOCATION. */
export const DEFAULT_MAP_DELTA = {
  latitudeDelta: num(process.env.EXPO_PUBLIC_DEFAULT_MAP_DELTA, 0.02),
  longitudeDelta: num(process.env.EXPO_PUBLIC_DEFAULT_MAP_DELTA, 0.02),
} as const;
