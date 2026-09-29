import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  hasMovedBeyondThreshold,
  decodePolyline,
} from '../geoUtils';

describe('haversineDistance', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistance(13.6929, -89.2182, 13.6929, -89.2182)).toBe(0);
  });

  it('measures San Salvador to Santa Ana great-circle (~49.8 km)', () => {
    // Straight-line, not road distance (the highway is ~65 km).
    const km = haversineDistance(13.6929, -89.2182, 13.9942, -89.5597);
    expect(km).toBeCloseTo(49.8, 1);
  });

  it('is symmetric', () => {
    const ab = haversineDistance(13.6929, -89.2182, 13.9942, -89.5597);
    const ba = haversineDistance(13.9942, -89.5597, 13.6929, -89.2182);
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('handles the equator-to-pole quarter meridian (~10007 km)', () => {
    expect(haversineDistance(0, 0, 90, 0)).toBeCloseTo(10007.54, 1);
  });

  it('handles crossing the antimeridian', () => {
    // 1 degree of longitude apart, straddling 180
    const km = haversineDistance(0, 179.5, 0, -179.5);
    expect(km).toBeCloseTo(111.19, 1);
  });
});

describe('hasMovedBeyondThreshold', () => {
  it('is false when the operator has not moved', () => {
    expect(hasMovedBeyondThreshold(13.6929, -89.2182, 13.6929, -89.2182)).toBe(false);
  });

  it('is false for a jitter smaller than the default 100 m threshold', () => {
    // ~11 m north
    expect(hasMovedBeyondThreshold(13.6930, -89.2182, 13.6929, -89.2182)).toBe(false);
  });

  it('is true for a move larger than the default threshold', () => {
    // ~1.1 km north
    expect(hasMovedBeyondThreshold(13.7029, -89.2182, 13.6929, -89.2182)).toBe(true);
  });

  it('respects a custom threshold', () => {
    // ~1.1 km move, 5 km threshold
    expect(hasMovedBeyondThreshold(13.7029, -89.2182, 13.6929, -89.2182, 5)).toBe(false);
  });
});

describe('decodePolyline', () => {
  it('returns an empty array for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });

  it('decodes the reference example from the Google spec', () => {
    // Documented fixture: _p~iF~ps|U_ulLnnqC_mqNvxq`@
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ]);
  });

  it('decodes a single point', () => {
    expect(decodePolyline('_p~iF~ps|U')).toEqual([
      { latitude: 38.5, longitude: -120.2 },
    ]);
  });

  it('decodes a southbound route (negative latitude deltas)', () => {
    // The Google fixture only ever increases latitude, so it never exercises
    // the two's-complement branch. This route goes south and west, so both
    // deltas are negative on every segment.
    expect(decodePolyline('skqrAvlp_ProAvhAnzD~{B')).toEqual([
      { latitude: 13.6929, longitude: -89.2182 },
      { latitude: 13.68, longitude: -89.23 },
      { latitude: 13.65, longitude: -89.25 },
    ]);
  });

  it('handles a segment that reverses direction', () => {
    const pts = decodePolyline('skqrAvlp_ProAvhAnzD~{B');
    expect(pts[1].latitude).toBeLessThan(pts[0].latitude);
    expect(pts[2].latitude).toBeLessThan(pts[1].latitude);
  });

  it('produces coordinates within valid geographic bounds', () => {
    for (const p of decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')) {
      expect(p.latitude).toBeGreaterThanOrEqual(-90);
      expect(p.latitude).toBeLessThanOrEqual(90);
      expect(p.longitude).toBeGreaterThanOrEqual(-180);
      expect(p.longitude).toBeLessThanOrEqual(180);
    }
  });

  it('returns more than 2 points for a real route (guards the straight-line regression)', () => {
    // A real Directions polyline is many points; a fallback straight line is 2.
    // This is the invariant the 12-Feb tracking fixes were about.
    const decoded = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decoded.length).toBeGreaterThan(2);
  });
});
