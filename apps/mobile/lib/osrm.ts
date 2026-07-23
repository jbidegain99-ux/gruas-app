// Cliente de OSRM (OpenStreetMap Routing Machine) para rutas reales por
// carretera SIN API key. Devuelve los "legs" (tramos) entre waypoints, para
// poder pedir operador->recogida->destino en UNA sola llamada.
//
// El servidor publico router.project-osrm.org es para demo/MVP (rate limit
// ~1 req/s). Para produccion conviene auto-hospedar OSRM o usar Google.

import { decodePolyline } from './geoUtils';

export interface OsrmLeg {
  km: number;
  min: number;
}

/**
 * Ruta en auto entre >=2 puntos. Retorna un leg por cada par consecutivo
 * (points.length - 1 legs). null si OSRM no responde o hay <2 puntos.
 */
export async function osrmLegs(
  points: { lat: number; lng: number }[]
): Promise<OsrmLeg[] | null> {
  if (points.length < 2) return null;
  try {
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) return null;
    const data = await res.json();
    if (data?.code !== 'Ok' || !Array.isArray(data.routes?.[0]?.legs)) return null;

    return data.routes[0].legs.map((leg: { distance: number; duration: number }) => ({
      km: Math.round((leg.distance / 1000) * 10) / 10,
      min: Math.max(1, Math.round(leg.duration / 60)),
    }));
  } catch {
    return null;
  }
}

/**
 * Geometría de la ruta real por carretera a través de >=2 puntos, como lista de
 * coords {lat,lng} lista para dibujar en el mapa (línea que sigue las calles).
 * null si OSRM no responde o hay <2 puntos, para que el llamador degrade a una
 * línea recta sin romperse.
 */
export async function osrmRoutePath(
  points: { lat: number; lng: number }[]
): Promise<{ lat: number; lng: number }[] | null> {
  if (points.length < 2) return null;
  try {
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=polyline`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) return null;
    const data = await res.json();
    const geometry = data?.routes?.[0]?.geometry;
    if (data?.code !== 'Ok' || typeof geometry !== 'string') return null;

    return decodePolyline(geometry).map((p) => ({ lat: p.latitude, lng: p.longitude }));
  } catch {
    return null;
  }
}
