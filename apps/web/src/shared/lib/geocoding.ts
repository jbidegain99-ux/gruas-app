// Resolución de coordenadas -> dirección para la web (admin), vía Nominatim
// (OpenStreetMap), gratis y sin API key. Las solicitudes viejas guardaron
// coordenadas como dirección; esto las muestra legibles.

const COORD_RE = /^\s*-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/;

export function looksLikeCoords(address: string | null | undefined): boolean {
  return !!address && COORD_RE.test(address);
}

const cache = new Map<string, string>();

/**
 * Si `address` es un par de coordenadas, lo resuelve a una dirección corta
 * (con caché). Si no, lo retorna tal cual. Nunca lanza.
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
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es&zoom=18&addressdetails=1`
    );
    if (res.ok) {
      const data = await res.json();
      const a = data?.address;
      if (a) {
        const line = a.road
          ? `${a.road}${a.house_number ? ' ' + a.house_number : ''}`
          : a.amenity || a.building || a.shop;
        const area = a.neighbourhood || a.suburb || a.quarter || a.village;
        const city = a.city || a.town || a.municipality || a.county;
        const short = [line, area, city].filter(Boolean).join(', ');
        if (short) {
          cache.set(key, short);
          return short;
        }
      }
      if (data?.display_name) {
        cache.set(key, data.display_name);
        return data.display_name as string;
      }
    }
  } catch {
    // sin red o bloqueado; devolvemos las coords
  }
  return address;
}
