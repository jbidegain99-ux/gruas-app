// Routing por carretera GRATIS via OSRM (OpenStreetMap Routing Machine).
// Devuelve la ruta mas directa: distancia real, duracion y geometria (polyline
// codificada, mismo formato que Google -> el decoder del cliente sirve igual).
//
// Se usa como capa intermedia entre Google Directions (si hay API key) y el
// fallback haversine (linea recta). El servidor publico router.project-osrm.org
// es para demo/MVP; en produccion conviene auto-hospedar OSRM o usar Google.

export interface OsrmRoute {
  distance_km: number;
  duration_minutes: number;
  polyline: string | null;
}

/**
 * Calcula la ruta en auto entre origen y destino. Nunca lanza: retorna null si
 * OSRM no responde, para que el llamador caiga a haversine.
 */
export async function osrmRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<OsrmRoute | null> {
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${originLng},${originLat};${destLng},${destLat}` +
      `?overview=full&geometries=polyline`;

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
    if (data?.code !== 'Ok' || !Array.isArray(data.routes) || !data.routes.length) {
      return null;
    }

    const r = data.routes[0];
    return {
      distance_km: Math.round((r.distance / 1000) * 10) / 10,
      duration_minutes: Math.max(1, Math.round(r.duration / 60)),
      polyline: typeof r.geometry === 'string' ? r.geometry : null,
    };
  } catch {
    return null;
  }
}
