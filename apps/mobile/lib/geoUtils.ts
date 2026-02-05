/**
 * Geographic utility functions for distance calculations and throttling
 */

/**
 * Calculate the distance between two coordinates using Haversine formula
 * @param lat1 Latitude of first point
 * @param lng1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lng2 Longitude of second point
 * @returns Distance in kilometers
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Check if a position has moved more than a threshold distance from a reference point
 * @param currentLat Current latitude
 * @param currentLng Current longitude
 * @param referenceLat Reference latitude
 * @param referenceLng Reference longitude
 * @param thresholdKm Threshold in kilometers (default: 0.1 = 100 meters)
 * @returns true if moved more than threshold
 */
export function hasMovedBeyondThreshold(
  currentLat: number,
  currentLng: number,
  referenceLat: number,
  referenceLng: number,
  thresholdKm: number = 0.1
): boolean {
  const distance = haversineDistance(currentLat, currentLng, referenceLat, referenceLng);
  return distance > thresholdKm;
}

/**
 * Position tracker for throttling updates based on movement
 */
export class MovementThrottle {
  private lastPosition: { lat: number; lng: number } | null = null;
  private thresholdKm: number;

  constructor(thresholdKm: number = 0.1) {
    this.thresholdKm = thresholdKm;
  }

  /**
   * Check if should update based on movement from last position
   * @param lat Current latitude
   * @param lng Current longitude
   * @returns true if should update (moved beyond threshold or first call)
   */
  shouldUpdate(lat: number, lng: number): boolean {
    if (!this.lastPosition) {
      this.lastPosition = { lat, lng };
      return true;
    }

    const shouldUpdate = hasMovedBeyondThreshold(
      lat,
      lng,
      this.lastPosition.lat,
      this.lastPosition.lng,
      this.thresholdKm
    );

    if (shouldUpdate) {
      this.lastPosition = { lat, lng };
    }

    return shouldUpdate;
  }

  /**
   * Reset the tracker
   */
  reset(): void {
    this.lastPosition = null;
  }

  /**
   * Get the last tracked position
   */
  getLastPosition(): { lat: number; lng: number } | null {
    return this.lastPosition;
  }
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Decode a Google Encoded Polyline string into an array of coordinates.
 * Based on the Google Polyline Algorithm:
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    // Decode latitude
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    // Decode longitude
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return points;
}
