// Reverse geocoding (coordenadas -> direccion legible) SIN depender de Google.
// Estrategia en cascada:
//   1. Geocoder nativo de Expo (funciona en algunos Android; en Expo Go suele fallar).
//   2. Nominatim (OpenStreetMap) — gratis, sin API key.
//   3. Ultimo recurso: las coordenadas formateadas (para no dejar la direccion vacia).
import * as Location from 'expo-location';

/**
 * Corta una promesa que no responde. El geocoder nativo y el GPS pueden quedarse
 * colgados (teléfono recién encendido, mala señal) y la pantalla esperaba para
 * siempre: con esto se sigue al respaldo.
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// fetch con límite de tiempo (Nominatim puede tardar o no responder).
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

const NOMINATIM_HEADERS = { 'User-Agent': 'BudiApp/1.0 (asistencia vial El Salvador)' };

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

// Un "plus code" de Google (MQRV+7C5): codifica coordenadas, no una direccion.
// Su alfabeto excluye vocales y las letras que se confunden (A,E,I,L,O,S,U,Z),
// por eso el rango raro.
const PLUS_CODE_RE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}$/i;
export function isPlusCode(text: string): boolean {
  return PLUS_CODE_RE.test(text.trim());
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
  // Respaldo por si el geocoder nativo solo da ciudad/pais y Nominatim falla.
  let coarse = '';

  // 1. Geocoder nativo de Expo
  try {
    const [r] = await withTimeout(Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }), 5000);
    if (r) {
      // Google usa el `name` para devolver un plus code (MQRV+7C5) cuando el
      // punto no tiene direccion postal. Al operador eso no le dice nada, asi
      // que lo descartamos y probamos con Nominatim, que suele traer la calle.
      const name = r.name && !isPlusCode(r.name) ? r.name : null;
      const parts = [r.street, name, r.city, r.region, r.country].filter(Boolean);
      const addr = [...new Set(parts)].join(', ');
      if (addr && (r.street || name)) return addr;
      coarse = addr;
    }
  } catch {
    // Esperado en Expo Go; seguimos al fallback.
  }

  // 2. Nominatim (OSM). Requiere User-Agent identificable (politica de uso).
  try {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es&zoom=18&addressdetails=1`,
      { headers: NOMINATIM_HEADERS },
      6000
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

  // 3. Respaldo: lo poco que dio el geocoder nativo antes que las coordenadas.
  return coarse || coordsLabel(lat, lng);
}

export type PlaceResult = { label: string; secondary: string; lat: number; lng: number };

// Mismos límites que valida el servidor (create_service_request, 00064).
export function inElSalvador(lat: number, lng: number): boolean {
  return lat >= 13.0 && lat <= 14.5 && lng >= -90.2 && lng <= -87.5;
}

/**
 * Busca una dirección en El Salvador sin Google: geocoder nativo y, si no
 * responde o no encuentra, Nominatim (OSM). Devuelve las coordenadas junto con
 * el texto, para no tener que geocodificar otra vez al elegir un resultado.
 */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  try {
    // El geocoder del teléfono busca en todo el mundo: "Zaragoza" daba la de
    // España. Se le pide El Salvador y se descarta lo que caiga fuera.
    const conPais = /salvador/i.test(q) ? q : `${q}, El Salvador`;
    const results = (await withTimeout(Location.geocodeAsync(conPais), 5000)).filter((r) =>
      inElSalvador(r.latitude, r.longitude)
    );
    if (results.length > 0) {
      return results.slice(0, 5).map((r) => ({ label: q, secondary: 'El Salvador', lat: r.latitude, lng: r.longitude }));
    }
  } catch {
    // Sin geocoder nativo (web, Expo Go) o no respondió: seguimos con OSM.
  }

  try {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=sv&format=json&limit=5&accept-language=es`,
      { headers: NOMINATIM_HEADERS },
      6000
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    return data.filter((d) => inElSalvador(Number(d.lat), Number(d.lon))).map((d) => {
      const [first, ...rest] = d.display_name.split(', ');
      return { label: first, secondary: rest.slice(0, 3).join(', '), lat: Number(d.lat), lng: Number(d.lon) };
    });
  } catch {
    return [];
  }
}

/**
 * Posición actual sin esperar para siempre: pide un fix con límite de tiempo y,
 * si no llega (interiores, GPS recién encendido), usa la última conocida.
 * Lanza si no hay ninguna, para que la pantalla muestre su aviso.
 */
export async function getPositionFast(): Promise<{ latitude: number; longitude: number }> {
  try {
    const pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      10000
    );
    return pos.coords;
  } catch {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
    if (last) return last.coords;
    throw new Error('Sin ubicación');
  }
}
