/**
 * Persistent distance cache using AsyncStorage
 * Reduces API calls by caching distance calculations between coordinates
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

interface CachedDistance {
  distance_km: number;
  distance_text: string;
  duration_minutes: number;
  duration_text: string;
  is_fallback?: boolean;
  cached_at: number;
}

// Cache expires after 24 hours
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

// Prefix for cache keys
const CACHE_PREFIX = 'dist_cache:';

/**
 * Generate a cache key from coordinates
 * Rounds to 2 decimal places (~1km precision) to improve cache hits
 */
function getCacheKey(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): string {
  const round = (n: number) => Math.round(n * 100) / 100;
  return `${CACHE_PREFIX}${round(originLat)},${round(originLng)}:${round(destLat)},${round(destLng)}`;
}

/**
 * Get cached distance if available and not expired
 */
export async function getCachedDistance(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<CachedDistance | null> {
  try {
    const key = getCacheKey(originLat, originLng, destLat, destLng);
    const cached = await AsyncStorage.getItem(key);

    if (!cached) {
      return null;
    }

    const data: CachedDistance = JSON.parse(cached);

    // Check if cache is expired
    if (Date.now() - data.cached_at > CACHE_DURATION_MS) {
      // Remove expired cache entry
      await AsyncStorage.removeItem(key);
      return null;
    }

    console.log('[DistanceCache] Cache hit for:', key);
    return data;
  } catch (error) {
    console.warn('[DistanceCache] Error reading cache:', error);
    return null;
  }
}

/**
 * Store distance calculation in cache
 */
export async function setCachedDistance(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  distance_km: number,
  distance_text: string,
  duration_minutes: number,
  duration_text: string,
  is_fallback?: boolean
): Promise<void> {
  try {
    const key = getCacheKey(originLat, originLng, destLat, destLng);
    const data: CachedDistance = {
      distance_km,
      distance_text,
      duration_minutes,
      duration_text,
      is_fallback,
      cached_at: Date.now(),
    };

    await AsyncStorage.setItem(key, JSON.stringify(data));
    console.log('[DistanceCache] Cached distance for:', key);
  } catch (error) {
    console.warn('[DistanceCache] Error writing cache:', error);
  }
}

/**
 * Clear all distance cache entries
 * Useful for debugging or when cache needs to be invalidated
 */
export async function clearDistanceCache(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter((key) => key.startsWith(CACHE_PREFIX));

    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
      console.log(`[DistanceCache] Cleared ${cacheKeys.length} cache entries`);
    }
  } catch (error) {
    console.warn('[DistanceCache] Error clearing cache:', error);
  }
}

/**
 * Get cache statistics
 * Returns number of cached entries and approximate size
 */
export async function getCacheStats(): Promise<{ count: number; oldestAge: number | null }> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter((key) => key.startsWith(CACHE_PREFIX));

    if (cacheKeys.length === 0) {
      return { count: 0, oldestAge: null };
    }

    // Find oldest entry
    let oldestAge = 0;
    for (const key of cacheKeys) {
      const cached = await AsyncStorage.getItem(key);
      if (cached) {
        const data: CachedDistance = JSON.parse(cached);
        const age = Date.now() - data.cached_at;
        if (age > oldestAge) {
          oldestAge = age;
        }
      }
    }

    return {
      count: cacheKeys.length,
      oldestAge: oldestAge > 0 ? Math.round(oldestAge / 1000 / 60) : null, // in minutes
    };
  } catch (error) {
    console.warn('[DistanceCache] Error getting stats:', error);
    return { count: 0, oldestAge: null };
  }
}
