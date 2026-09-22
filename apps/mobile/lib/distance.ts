// Utilidades de distancia locales (sin red, sin API key). Mismo criterio que la
// Edge Function `calculate-distance`: haversine * 1.3 para aproximar carretera.

/** Distancia aproximada de carretera en km entre dos coordenadas. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // radio terrestre en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const straight = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return straight * 1.3;
}

/** Estima minutos de viaje asumiendo ~30 km/h urbano (El Salvador). */
export function estimateMinutes(km: number): number {
  return Math.max(1, Math.round((km / 30) * 60));
}

/** Formatea km de forma legible (metros bajo 1 km). */
export function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}
