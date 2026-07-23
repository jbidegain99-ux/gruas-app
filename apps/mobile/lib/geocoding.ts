// Reverse geocoding (coordenadas -> direccion legible) SIN depender de Google.
// Estrategia en cascada:
//   1. Geocoder nativo de Expo (funciona en algunos Android; en Expo Go suele fallar).
//   2. Nominatim (OpenStreetMap) — gratis, sin API key.
//   3. Ultimo recurso: las coordenadas formateadas (para no dejar la direccion vacia).
import * as Location from 'expo-location';

/** Formatea coords como texto legible de respaldo. */
export function coordsLabel(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

// Detecta si un texto es solo un par de coordenadas ("13.69, -89.21"), para
// resolverlo a dirección al mostrarlo (solicitudes viejas guardaron coords).
const COORD_RE = /^\s*-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/;
export function looksLikeCoords(address: string | null | undefined): boolean {
  return !!address && COORD_RE.test(address);
}

// Caché en memoria de direcciones ya resueltas (evita repetir llamadas).
const displayCache = new Map<string, string>();

/**
 * Devuelve la dirección a mostrar: si `address` es un par de coordenadas,
 * la resuelve a texto (con caché); si no, la retorna tal cual.
 */
export async function resolveDisplayAddress(
  address: string | null | undefined,
  lat?: number | null,
  lng?: number | null
): Promise<string> {
  if (!address) return '';
  if (!looksLikeCoords(address)) return address;
  if (typeof lat !== 'number' || typeof lng !== 'number') return address;

  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = displayCache.get(key);
  if (cached) return cached;

  const resolved = await reverseGeocode(lat, lng);
  displayCache.set(key, resolved);
  return resolved;
}

/**
 * Devuelve una direccion legible para unas coordenadas. Nunca lanza: si todo
 * falla, retorna las coords formateadas.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  // 1. Geocoder nativo de Expo
  try {
    const [r] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (r) {
      const parts = [r.street, r.name, r.city, r.region, r.country].filter(Boolean);
      const addr = [...new Set(parts)].join(', ');
      if (addr) return addr;
    }
  } catch {
    // Esperado en Expo Go; seguimos al fallback.
  }

  // 2. Nominatim (OSM). Requiere User-Agent identificable (politica de uso).
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es&zoom=18&addressdetails=1`,
      { headers: { 'User-Agent': 'BudiApp/1.0 (asistencia vial El Salvador)' } }
    );
    if (res.ok) {
      const data = await res.json();
      // Preferimos armar una direccion corta con los campos estructurados;
      // display_name completo es muy largo (9+ segmentos) para la UI.
      const a = data?.address;
      if (a) {
        const line = a.road
          ? `${a.road}${a.house_number ? ' ' + a.house_number : ''}`
          : a.amenity || a.building || a.shop;
        const area = a.neighbourhood || a.suburb || a.quarter || a.village;
        const city = a.city || a.town || a.municipality || a.county;
        const short = [line, area, city].filter(Boolean).join(', ');
        if (short) return short;
      }
      if (data?.display_name) return data.display_name as string;
    }
  } catch {
    // Sin red o bloqueado; caemos a coords.
  }

  // 3. Respaldo
  return coordsLabel(lat, lng);
}
