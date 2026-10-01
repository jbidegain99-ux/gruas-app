// Lo que el portal MOPT muestra de cada socio de su flota (00155).

// Misma ventana de "ubicación fresca" que el mapa de flota del admin y que
// mopt_stale_on_service en la base (5 min).
export const FRESH_MS = 5 * 60 * 1000;

/** "★ 4.8 (12)" o "Sin calificaciones". Solo servicios del programa. */
export function ratingLabel(avg: number | string | null | undefined, count: number | string | null | undefined): string {
  const n = Number(count ?? 0);
  if (!n || avg == null) return 'Sin calificaciones';
  return `★ ${Number(avg).toLocaleString('es-SV', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} (${n})`;
}

/** Tiene un servicio abierto y no manda GPS hace más de 5 min (o nunca mandó). */
export function staleOnService(
  r: { active_request_id: string | null; updated_at: string | null },
  now: number
): boolean {
  if (!r.active_request_id) return false;
  if (!r.updated_at) return true;
  return now - new Date(r.updated_at).getTime() >= FRESH_MS;
}

/** "hace 7 min", "hace 2 h", "hace 3 d", "nunca". */
export function lastSeen(iso: string | null, now: number): string {
  if (!iso) return 'nunca';
  const min = Math.round((now - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}
