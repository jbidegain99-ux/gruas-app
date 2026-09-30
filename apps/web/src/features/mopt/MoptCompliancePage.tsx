'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, MapPin, Route } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { ServiceTypeBadge } from '@/shared/components/ServiceTypeBadge';
import { svToday } from '@/shared/components/LedgerPaymentModals';
import { duration } from '@/shared/lib/format';

// Tablero de cumplimiento del programa (backlog MOPT-01, migr. 00107): casos
// atendidos, llegada promedio y % a tiempo contra el SLA pactado, por tipo de
// servicio y por zona. Mismas definiciones que el admin (request_sla y km del
// caso), así que los números cuadran con los de Budi para el mismo período.

type Compliance = {
  targets: { assignment_minutes: number; arrival_minutes: number } | null;
  completed: number;
  avg_arrival_seconds: number | null;
  avg_assignment_seconds: number | null;
  on_time_pct: number | null;
  assignment_met_pct: number | null;
  km_total: number;
  by_service: { service_type: string; count: number }[];
  by_zone: { zone: string; count: number }[];
};

const inputClass =
  'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200';
const card = 'rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Number(v)}%`);

export default function MoptCompliancePage() {
  const hoy = svToday();
  const [desde, setDesde] = useState(hoy.slice(0, 8) + '01');
  const [hasta, setHasta] = useState(hoy);
  const [data, setData] = useState<Compliance | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Separado de `data`: con un error la pantalla quedaba en "Cargando…" para siempre.
  // Derivado del período cargado: al cambiar las fechas se veían los números
  // del período anterior bajo las fechas nuevas hasta que llegaba la respuesta.
  const periodo = `${desde}|${hasta}`;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== periodo;

  useEffect(() => {
    let alive = true;
    createClient()
      .rpc('mopt_compliance', { p_from: desde, p_to: hasta })
      .then(({ data: res, error: e }) => {
        if (!alive) return;
        setError(e?.message ?? null);
        setData((res as unknown as Compliance) ?? null);
        setLoadedFor(`${desde}|${hasta}`);
      });
    return () => {
      alive = false;
    };
  }, [desde, hasta]);

  const maxZone = Math.max(1, ...(data?.by_zone ?? []).map((z) => z.count));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Cumplimiento</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Casos atendidos y tiempos contra el SLA pactado
            {data?.targets && ` (asignar en ${data.targets.assignment_minutes} min, llegar en ${data.targets.arrival_minutes} min)`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="text-zinc-600 dark:text-zinc-400">
            Desde
            <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className={`${inputClass} ml-2`} />
          </label>
          <label className="text-zinc-600 dark:text-zinc-400">
            Hasta
            <input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} className={`${inputClass} ml-2`} />
          </label>
        </div>
      </div>

      {error && !loading && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-500">Cargando…</p>
      ) : !data ? (
        !error && <p className="text-sm text-zinc-500">Sin datos para el período.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile Icon={CheckCircle2} label="Casos atendidos" value={String(data.completed)} />
            <Tile
              Icon={Clock}
              label="Llegada promedio"
              value={data.avg_arrival_seconds == null ? '—' : duration(data.avg_arrival_seconds / 60)}
              sub={`asignación ${data.avg_assignment_seconds == null ? '—' : duration(data.avg_assignment_seconds / 60)}`}
            />
            <Tile
              Icon={CheckCircle2}
              label="Llegadas a tiempo"
              value={pct(data.on_time_pct)}
              sub={`asignación a tiempo ${pct(data.assignment_met_pct)}`}
            />
            <Tile Icon={Route} label="Km recorridos" value={`${Number(data.km_total).toLocaleString('es-SV', { maximumFractionDigits: 1 })} km`} sub="aproximación + arrastre, por GPS" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className={card}>
              <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-white">Casos por tipo de servicio</h2>
              {data.by_service.length === 0 ? (
                <p className="text-sm text-zinc-500">Sin casos en el período.</p>
              ) : (
                <ul className="space-y-2">
                  {data.by_service.map((s) => (
                    <li key={s.service_type} className="flex items-center justify-between">
                      <ServiceTypeBadge serviceType={s.service_type} />
                      <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-white">{s.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={card}>
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                <MapPin className="h-4 w-4 text-zinc-400" /> Casos por zona
              </h2>
              {data.by_zone.length === 0 ? (
                <p className="text-sm text-zinc-500">Sin casos en el período.</p>
              ) : (
                <ul className="space-y-3">
                  {data.by_zone.map((z) => (
                    <li key={z.zone}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-zinc-700 dark:text-zinc-300">{z.zone}</span>
                        <span className="font-semibold tabular-nums text-zinc-900 dark:text-white">{z.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className="h-2 rounded-full bg-budi-primary-500" style={{ width: `${(z.count / maxZone) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <p className="text-xs text-zinc-500">
            Casos completados en el período (días de El Salvador). Llegada = desde que un socio operador acepta hasta que
            confirma el PIN de confirmación en el sitio.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ Icon, label, value, sub }: { Icon: typeof Clock; label: string; value: string; sub?: string }) {
  return (
    <div className={card}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{label}</p>
        <Icon className="h-4 w-4 text-zinc-400" />
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}
