// Modelo y carga de datos del mapa de flota. Vive aparte de los componentes
// para que FleetMap (client, ssr:false) y AdminFleetPage compartan los tipos
// sin arrastrar Leaflet al bundle del servidor.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Una ubicación se considera fresca dentro de esta ventana (igual que el dashboard y assign_nearest_operator). */
export const FRESH_MS = 5 * 60 * 1000;

export type OperatorState = 'on_service' | 'available' | 'stale';

export const OPERATOR_STATE_META: Record<
  OperatorState,
  { label: string; pin: string; dot: string; chip: string }
> = {
  on_service: {
    label: 'En servicio',
    pin: '#2D5F8B',
    dot: 'bg-budi-primary-500',
    chip: 'bg-budi-primary-50 text-budi-primary-700 dark:bg-budi-primary-900/40 dark:text-budi-primary-300',
  },
  available: {
    label: 'Disponible',
    pin: '#16a34a',
    dot: 'bg-green-500',
    chip: 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  },
  stale: {
    label: 'Sin señal',
    pin: '#a1a1aa',
    dot: 'bg-zinc-400',
    chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  },
};

export type FleetOperator = {
  id: string;
  name: string;
  phone: string | null;
  lat: number;
  lng: number;
  state: OperatorState;
  updatedAt: string;
  lastSeenLabel: string;
  activeRequestId: string | null;
  activeRequestAddress: string | null;
};

/** "hace 2 min" / "hace 3 h" / "hace 2 d" */
export function lastSeen(updatedAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(updatedAt).getTime()) / 60000));
  if (minutes < 1) return 'hace instantes';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/**
 * Trae todos los operadores con ubicación conocida, su estado y el servicio que
 * estén atendiendo. Tres consultas en paralelo y join en JS: las relaciones de
 * `operator_locations` no están expuestas como embed en PostgREST.
 */
export async function fetchFleet(
  supabase: SupabaseClient,
  now: number
): Promise<FleetOperator[]> {
  const [{ data: locations }, { data: profiles }, { data: activeRequests }] = await Promise.all([
    supabase.from('operator_locations').select('operator_id, lat, lng, is_online, updated_at'),
    supabase.from('profiles').select('id, full_name, phone').eq('role', 'OPERATOR'),
    supabase
      .from('service_requests')
      .select('id, operator_id, pickup_address')
      .in('status', ['assigned', 'en_route', 'active']),
  ]);

  const nameById = new Map((profiles || []).map((p) => [p.id, p]));
  const requestByOperator = new Map(
    (activeRequests || []).filter((r) => r.operator_id).map((r) => [r.operator_id as string, r])
  );

  return (locations || [])
    // Sólo operadores: la tabla puede conservar filas de perfiles que cambiaron de rol.
    .filter((loc) => nameById.has(loc.operator_id))
    .map((loc) => {
      const profile = nameById.get(loc.operator_id);
      const request = requestByOperator.get(loc.operator_id) || null;
      // Sin GPS reciente es "Sin señal" aunque tenga un servicio abierto: "en
      // servicio" con la última posición de hace días escondía al socio perdido.
      const recent = now - new Date(loc.updated_at).getTime() < FRESH_MS;
      const state: OperatorState = !recent ? 'stale' : request ? 'on_service' : loc.is_online ? 'available' : 'stale';

      return {
        id: loc.operator_id,
        name: profile?.full_name || 'Socio operador',
        phone: profile?.phone ?? null,
        lat: loc.lat,
        lng: loc.lng,
        state,
        updatedAt: loc.updated_at,
        lastSeenLabel: lastSeen(loc.updated_at, now),
        activeRequestId: request?.id ?? null,
        activeRequestAddress: request?.pickup_address ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
