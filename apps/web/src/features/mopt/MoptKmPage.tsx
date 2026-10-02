'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { fetchAll } from '@/shared/lib/fetch-all';
import { ServiceTypeBadge } from '@/shared/components/ServiceTypeBadge';
import { svToday } from '@/shared/components/LedgerPaymentModals';
import { duration, formatDate } from '@/shared/lib/format';

// Km por grúa (backlog MOPT-02, migr. 00107): cuánto recorrió cada unidad del
// programa, separando aproximación (socio -> Usuario) y arrastre (Usuario ->
// destino), medido con el GPS del servicio, no con lo que declara el socio.

type Row = {
  operator_id: string | null;
  operator: string;
  plate: string;
  cases: number;
  approach_km: number;
  tow_km: number;
  total_km: number;
  on_time_pct: number | null;
};

type CaseRow = {
  request_id: string;
  folio: string | null;
  service_type: string;
  completed_at: string;
  approach_km: number | null;
  tow_km: number | null;
  declared_km: number | null;
  arrival_seconds: number | null;
  on_time: boolean | null;
};

const inputClass =
  'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200';

const km = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('es-SV', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function MoptKmPage() {
  const hoy = svToday();
  const [desde, setDesde] = useState(hoy.slice(0, 8) + '01');
  const [hasta, setHasta] = useState(hoy);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Casos de la fila abierta: cargando / error / listos (vacío incluido).
  const [cases, setCases] = useState<{ loading: boolean; error: string | null; rows: CaseRow[] }>({
    loading: false,
    error: null,
    rows: [],
  });
  // La fila abierta "de verdad": una respuesta que llega cuando ya se abrió
  // otra (o se cerró) se descarta.
  const openRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setOpen(null);
      openRef.current = null;
      const { data, error: e } = await createClient().rpc('mopt_km_by_vehicle', { p_from: desde, p_to: hasta });
      if (!alive) return;
      setError(e?.message ?? null);
      setRows((data as Row[]) ?? []);
      setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, [desde, hasta]);

  const key = (r: Row) => `${r.operator_id}:${r.plate}`;

  const toggle = async (r: Row) => {
    const k = key(r);
    if (open === k) {
      openRef.current = null;
      return setOpen(null);
    }
    openRef.current = k;
    setOpen(k);
    setCases({ loading: true, error: null, rows: [] });
    // Por tandas (max_rows = 1000): los casos de una unidad en un año pasan de mil.
    const supabase = createClient();
    const { data, error: e } = await fetchAll((from, to) =>
      supabase
        .rpc('mopt_vehicle_cases', {
          p_operator_id: r.operator_id as string,
          p_plate: r.plate,
          p_from: desde,
          p_to: hasta,
        })
        .order('completed_at', { ascending: false })
        .order('request_id')
        .range(from, to)
    );
    if (openRef.current !== k) return;
    setCases({ loading: false, error: e?.message ?? null, rows: (data as CaseRow[]) ?? [] });
  };

  const totals = rows.reduce(
    (a, r) => ({
      cases: a.cases + Number(r.cases),
      approach: a.approach + Number(r.approach_km),
      tow: a.tow + Number(r.tow_km),
      total: a.total + Number(r.total_km),
    }),
    { cases: 0, approach: 0, tow: 0, total: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Km por grúa</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Kilómetros reales por unidad, medidos con el GPS de cada servicio
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

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">Grúa (placa)</th>
              <th className="px-4 py-3 font-medium">Socio operador</th>
              <th className="px-4 py-3 text-right font-medium">Casos</th>
              <th className="px-4 py-3 text-right font-medium">Km aproximación</th>
              <th className="px-4 py-3 text-right font-medium">Km arrastre</th>
              <th className="px-4 py-3 text-right font-medium">Km totales</th>
              <th className="px-4 py-3 text-right font-medium">% a tiempo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Cargando…</td></tr>
            ) : error ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-red-600 dark:text-red-400">No se pudieron cargar los km: {error}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Sin casos completados en el período.</td></tr>
            ) : (
              rows.map((r) => (
                <Fragment key={key(r)}>
                  <tr className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => toggle(r)}>
                    <td className="px-4 py-3 font-mono font-medium text-zinc-900 dark:text-white">
                      {/* Botón para llegar con teclado; la fila entera sigue siendo clicable. */}
                      <button
                        type="button"
                        aria-expanded={open === key(r)}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(r);
                        }}
                        className="inline-flex items-center gap-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-budi-primary-500"
                      >
                        {open === key(r) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {r.plate}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{r.operator}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.cases}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{km(r.approach_km)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{km(r.tow_km)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">{km(r.total_km)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.on_time_pct == null ? '—' : `${Number(r.on_time_pct)}%`}</td>
                  </tr>
                  {open === key(r) && (
                    <tr>
                      <td colSpan={7} className="bg-zinc-50 px-4 py-3 dark:bg-zinc-950/40">
                        {cases.loading ? (
                          <p className="text-sm text-zinc-500">Cargando casos…</p>
                        ) : cases.error ? (
                          <p className="text-sm text-red-600 dark:text-red-400">No se pudieron cargar los casos: {cases.error}</p>
                        ) : cases.rows.length === 0 ? (
                          <p className="text-sm text-zinc-500">Sin casos de esta grúa en el período.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead className="text-left uppercase tracking-wide text-zinc-500">
                              <tr>
                                <th className="py-1 pr-3 font-medium">Caso</th>
                                <th className="py-1 pr-3 font-medium">Servicio</th>
                                <th className="py-1 pr-3 font-medium">Completado</th>
                                <th className="py-1 pr-3 text-right font-medium">Aprox.</th>
                                <th className="py-1 pr-3 text-right font-medium">Arrastre</th>
                                <th className="py-1 pr-3 text-right font-medium">Declarado</th>
                                <th className="py-1 pr-3 text-right font-medium">Llegada</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cases.rows.map((c) => (
                                <tr key={c.request_id}>
                                  <td className="py-1 pr-3">
                                    <Link href={`/mopt/servicios/${c.request_id}`} className="font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                                      {c.folio ?? 'Ver recorrido'}
                                    </Link>
                                  </td>
                                  <td className="py-1 pr-3"><ServiceTypeBadge serviceType={c.service_type} /></td>
                                  <td className="py-1 pr-3 text-zinc-600 dark:text-zinc-400">{formatDate(c.completed_at, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/El_Salvador' })}</td>
                                  <td className="py-1 pr-3 text-right tabular-nums">{km(c.approach_km)}</td>
                                  <td className="py-1 pr-3 text-right tabular-nums">{km(c.tow_km)}</td>
                                  <td className="py-1 pr-3 text-right tabular-nums text-zinc-500">{km(c.declared_km)}</td>
                                  <td className="py-1 pr-3 text-right tabular-nums">
                                    {c.arrival_seconds == null ? '—' : duration(c.arrival_seconds / 60)}
                                    {c.on_time === false && <span className="ml-1 text-amber-600 dark:text-amber-400">(tarde)</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-zinc-200 font-semibold dark:border-zinc-700">
              <tr>
                <td className="px-4 py-3" colSpan={2}>Total del período</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.cases}</td>
                <td className="px-4 py-3 text-right tabular-nums">{km(totals.approach)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{km(totals.tow)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{km(totals.total)}</td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-zinc-500">
        &ldquo;Declarado&rdquo; es la distancia que el socio operador ingresó al completar; se muestra para contrastar con la
        medida por GPS. Un salto de GPS imposible (más de 150 km/h) se descarta.
      </p>
    </div>
  );
}
