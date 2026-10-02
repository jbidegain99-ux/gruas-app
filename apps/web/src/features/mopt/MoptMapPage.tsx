'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { createClient } from '@/shared/lib/supabase/client';
import { fetchAll } from '@/shared/lib/fetch-all';
import { svToday } from '@/shared/components/LedgerPaymentModals';
import type { LatLng, MapOperator, MapPoint, MapZone } from './MoptMap';
import { PORTAL_MAX_ROWS } from '@/shared/components/portal/case-filters';
import { FRESH_MS, lastSeen, ratingLabel, staleOnService } from './mopt-fleet';
import { StaleAlert } from './StaleAlert';

const MoptMap = dynamic(() => import('./MoptMap'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-zinc-500">Cargando mapa…</div>,
});

const REFRESH_MS = 30 * 1000;

type FleetRow = {
  operator_id: string;
  full_name: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  is_online: boolean;
  updated_at: string | null;
  active_request_id: string | null;
  active_status: string | null;
  active_address: string | null;
  // 00155
  active_folio: string | null;
  plate: string | null;
  avg_rating: number | null;
  ratings_count: number | null;
};

type ServiceRow = {
  id: string;
  folio: string | null;
  status: string;
  client_name: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_address: string | null;
};

type ZoneRow = { id: string; name: string; polygon: LatLng[]; is_active: boolean };

type State = 'on_service' | 'available' | 'stale' | 'no_location';
const STATE: Record<State, { label: string; color: string; dot: string }> = {
  on_service: { label: 'En servicio', color: '#2D5F8B', dot: 'bg-budi-primary-500' },
  available: { label: 'Disponible', color: '#16a34a', dot: 'bg-green-500' },
  stale: { label: 'Sin señal', color: '#a1a1aa', dot: 'bg-zinc-400' },
  no_location: { label: 'Nunca se conectó', color: '#a1a1aa', dot: 'bg-zinc-300' },
};

const IN_PROGRESS = new Set(['initiated', 'assigned', 'en_route', 'active']);
const SERVICE_COLOR = { progress: '#F5A25B', done: '#2D5F8B' };

function operatorState(r: FleetRow, now: number): State {
  if (r.lat == null || r.lng == null || !r.updated_at) return 'no_location';
  const fresh = now - new Date(r.updated_at).getTime() < FRESH_MS;
  // Sin GPS reciente es "Sin señal" aunque tenga un servicio abierto: un socio
  // "en servicio" visto hace días es justo lo que el MOPT necesita ver.
  if (!fresh) return 'stale';
  if (r.active_request_id) return 'on_service';
  return r.is_online ? 'available' : 'stale';
}

export default function MoptMapPage() {
  const hoy = svToday();
  const [desde, setDesde] = useState(hoy.slice(0, 8) + '01');
  const [fleet, setFleet] = useState<FleetRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [showServices, setShowServices] = useState(true);
  // Hasta la primera respuesta no se sabe si la flota está vacía.
  const [loaded, setLoaded] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const supabase = createClient();
      const [f, s, abiertos, z] = await Promise.all([
        supabase.rpc('mopt_fleet'),
        // Por tandas (max_rows = 1000): "desde" lo elige el MOPT y puede ser largo.
        fetchAll((from, to) =>
          supabase
            .rpc('mopt_list_services', { p_from: desde, p_to: svToday() })
            .order('created_at', { ascending: false })
            .order('id')
            .range(from, to)
        ),
        // 00142: lo que está en curso se ve aunque se haya pedido antes de "desde".
        supabase.rpc('mopt_in_progress_services'),
        supabase.rpc('mopt_zones_mine'),
      ]);
      if (!alive) return;
      setError(f.error?.message ?? s.error?.message ?? abiertos.error?.message ?? z.error?.message ?? null);
      setFleet((f.data as FleetRow[]) ?? []);
      const delPeriodo = (s.data as ServiceRow[]) ?? [];
      const ids = new Set(delPeriodo.map((r) => r.id));
      setTruncated(delPeriodo.length >= PORTAL_MAX_ROWS);
      setServices([...((abiertos.data as ServiceRow[]) ?? []).filter((r) => !ids.has(r.id)), ...delPeriodo]);
      setZones((z.data as unknown as ZoneRow[]) ?? []);
      setNow(Date.now());
      setLoaded(true);
    };
    load();
    // En vivo: la flota se mueve. 30 s es suficiente para ver quién está libre.
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [desde]);

  const rows = useMemo(() => fleet.map((r) => ({ ...r, state: operatorState(r, now) })), [fleet, now]);

  const mapOperators: MapOperator[] = rows
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => ({
      id: r.operator_id,
      name: r.full_name || 'Socio operador',
      lat: r.lat as number,
      lng: r.lng as number,
      color: STATE[r.state].color,
      lines: [
        STATE[r.state].label,
        ...(r.plate ? [`Grúa ${r.plate}`] : []),
        ratingLabel(r.avg_rating, r.ratings_count),
        ...(r.active_address ? [`Atendiendo: ${r.active_address}`] : []),
        ...(r.phone ? [r.phone] : []),
        `Visto ${lastSeen(r.updated_at, now)}`,
      ],
    }));

  const points: MapPoint[] = showServices
    ? services
        .filter((s) => s.pickup_lat != null && s.pickup_lng != null && s.status !== 'cancelled')
        .map((s) => ({
          id: s.id,
          lat: s.pickup_lat as number,
          lng: s.pickup_lng as number,
          color: IN_PROGRESS.has(s.status) ? SERVICE_COLOR.progress : SERVICE_COLOR.done,
          label: `${s.folio ?? 'Servicio'} · ${s.client_name ?? '—'} · ${s.pickup_address ?? ''}`,
        }))
    : [];

  const mapZones: MapZone[] = zones.map((z) => ({ id: z.id, name: z.name, polygon: z.polygon, active: z.is_active }));

  const counts = rows.reduce((acc, r) => ({ ...acc, [r.state]: (acc[r.state] ?? 0) + 1 }), {} as Record<State, number>);
  const enCurso = services.filter((s) => IN_PROGRESS.has(s.status));
  // 00155: con un servicio abierto y sin GPS reciente: hay que llamarlo.
  const sinSenal = rows.filter((r) => staleOnService(r, now));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Mapa</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Dónde está tu flota ahora, qué servicios están en curso y dónde atendieron. Se actualiza cada 30 segundos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <label className="flex items-center gap-2">
            <input id="show-services" type="checkbox" checked={showServices} onChange={(e) => setShowServices(e.target.checked)} />
            Servicios desde
          </label>
          <input
            id="map-desde"
            type="date"
            value={desde}
            max={hoy}
            onChange={(e) => e.target.value && setDesde(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">No se pudo cargar el mapa: {error}</p>}
      {sinSenal.length > 0 && <StaleAlert rows={sinSenal} now={now} />}
      {showServices && truncated && (
        <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Se muestran los 1 000 servicios más recientes; acota las fechas para ver el resto.
        </p>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        {/* "Nunca se conectó" solo si hay alguno: no sale en el mapa (no tiene
            posición) y sin contarlo la flota no sumaba. */}
        {(['on_service', 'available', 'stale', ...(counts.no_location ? ['no_location'] : [])] as State[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${STATE[s].dot}`} /> {STATE[s].label} ({counts[s] ?? 0})
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERVICE_COLOR.progress }} /> Servicio en curso
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERVICE_COLOR.done }} /> Servicio atendido
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm border-2 border-budi-primary-500" /> Zona del programa
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="h-[520px] overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
          <MoptMap operators={mapOperators} points={points} zones={mapZones} />
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">Tu flota</h2>
            {!loaded ? (
              <p className="text-sm text-zinc-500">Cargando…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-zinc-500">Todavía no hay socios operadores en tu programa.</p>
            ) : (
              <ul className="space-y-3">
                {rows.map((r) => (
                  <li key={r.operator_id} className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${STATE[r.state].dot}`} />
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-zinc-900 dark:text-white">
                        {r.full_name || 'Socio operador'}
                        {r.plate && <span className="ml-1.5 font-mono text-xs font-normal text-zinc-500">{r.plate}</span>}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {STATE[r.state].label} · visto {lastSeen(r.updated_at, now)}
                      </p>
                      <p className="text-xs text-zinc-500">{ratingLabel(r.avg_rating, r.ratings_count)}</p>
                      {r.active_request_id && (
                        <Link href={`/mopt/servicios/${r.active_request_id}`} className="text-xs text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                          Atendiendo: {r.active_address ?? 'ver servicio'}
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">En curso ({enCurso.length})</h2>
            {enCurso.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay servicios en curso.</p>
            ) : (
              <ul className="space-y-2">
                {enCurso.map((s) => (
                  <li key={s.id}>
                    <Link href={`/mopt/servicios/${s.id}`} className="block rounded-lg p-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
                      <p className="font-medium text-zinc-900 dark:text-white">{s.client_name ?? '—'}</p>
                      <p className="text-xs text-zinc-500">{s.pickup_address ?? '—'}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
