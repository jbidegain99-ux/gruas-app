'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Inbox } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { ServiceTypeBadge, serviceTypeLabel } from '@/shared/components/ServiceTypeBadge';
import { StatusBadge, STATUS_LABELS } from '@/shared/components/StatusBadge';
import { svToday } from '@/shared/components/LedgerPaymentModals';
import { CaseFilters } from '@/shared/components/portal/CaseFilters';
import { defaultCaseFilters, exportBasename, filterCases, zoneOptions } from '@/shared/components/portal/case-filters';
import { liveLabel, useOrgLive } from '@/shared/components/portal/useOrgLive';
import { exportTable, type ExportColumn } from '@/shared/lib/export/table-export';
import { money } from '@/shared/lib/format';

// B-17 / POR-03: fila de portal_insurer_cases(desde, hasta).
type Row = {
  folio: string;
  service_type: string;
  status: string;
  created_at: string;
  zone: string | null;
  total_price: number | null;
  coverage_status: string | null;
  cubierto: number | null;
  copago: number | null;
  assignment_met: boolean | null;
  arrival_met: boolean | null;
};

function SlaPill({ met }: { met: boolean | null }) {
  if (met === null)
    return <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">—</span>;
  return met ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">En tiempo</span>
  ) : (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">Fuera de SLA</span>
  );
}

const EXPORT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Folio', value: (r) => r.folio },
  { header: 'Fecha', value: (r) => new Date(r.created_at).toLocaleString('es-SV', { timeZone: 'America/El_Salvador' }) },
  { header: 'Servicio', value: (r) => serviceTypeLabel(r.service_type) },
  { header: 'Estado', value: (r) => STATUS_LABELS[r.status] ?? r.status },
  { header: 'Zona', value: (r) => r.zone },
  { header: 'A tu cargo (USD)', value: (r) => (r.cubierto == null ? null : Number(r.cubierto)) },
  { header: 'Copago del afiliado (USD)', value: (r) => (r.copago == null ? null : Number(r.copago)) },
  { header: 'Asignación en tiempo', value: (r) => (r.assignment_met == null ? null : r.assignment_met ? 'Sí' : 'No') },
  { header: 'Llegada en tiempo', value: (r) => (r.arrival_met == null ? null : r.arrival_met ? 'Sí' : 'No') },
];

export default function InsurerPortalPage() {
  const [allRows, setAllRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(() => defaultCaseFilters(svToday()));
  const { tick, live } = useOrgLive();

  useEffect(() => {
    let alive = true;
    createClient()
      .rpc('portal_insurer_cases', { p_from: filters.from, p_to: filters.to })
      .then(({ data, error: e }) => {
        if (!alive) return;
        setError(e?.message ?? null);
        if (!e) setAllRows((data as Row[]) ?? []);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [filters.from, filters.to, tick]);

  const rows = useMemo(() => filterCases(allRows, filters), [allRows, filters]);

  const stats = useMemo(() => {
    const total = rows.length;
    const completados = rows.filter((r) => r.status === 'completed').length;
    const conSla = rows.filter((r) => r.arrival_met !== null);
    const enTiempo = conSla.filter((r) => r.arrival_met).length;
    const pct = conSla.length ? Math.round((enTiempo / conSla.length) * 100) : null;
    // Lo que asumen sus pólizas. El bruto incluye el copago del afiliado, que no
    // se le factura a ella: mostrar el bruto acá sería prometerle otra cifra.
    const aCargo = rows.reduce((a, r) => a + Number(r.cubierto ?? 0), 0);
    return { total, completados, pct, aCargo };
  }, [rows]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Tus casos</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Cada servicio de tus afiliados, con su folio, estado y cumplimiento de SLA.{' '}
          <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
            <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-zinc-400'}`} aria-hidden="true" />
            {liveLabel(live)}
          </span>
        </p>
      </div>

      <div className="mb-6">
        <CaseFilters
          value={filters}
          onChange={setFilters}
          zones={zoneOptions(allRows)}
          exportDisabled={rows.length === 0}
          onExport={(f) => exportTable(rows, EXPORT_COLUMNS, f, exportBasename('casos', filters))}
        />
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">No se pudieron cargar los casos: {error}</p>}
      </div>

      {/* Resumen */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Casos" value={String(stats.total)} />
        <Stat label="Completados" value={String(stats.completados)} />
        <Stat label="Llegada en tiempo" value={stats.pct == null ? '—' : `${stats.pct}%`} />
        <Stat label="A cargo de tus pólizas" value={money(stats.aCargo)} />
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wider text-zinc-500 dark:border-zinc-800">
                <th className="px-4 py-3 font-medium">Folio</th>
                <th className="px-4 py-3 font-medium">Servicio</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Zona</th>
                <th className="px-4 py-3 text-right font-medium">A tu cargo</th>
                <th className="px-4 py-3 font-medium">Llegada (SLA)</th>
                <th className="px-4 py-3 text-right font-medium">Fecha</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-sm text-zinc-500">
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <Inbox className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                    <p className="mt-3 text-sm text-zinc-500">
                      {allRows.length === 0 ? 'No hay casos de tus afiliados en estas fechas.' : 'Ningún caso coincide con los filtros.'}
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.folio} className="text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/portal/${r.folio}`}
                        className="font-mono font-semibold text-budi-primary-600 hover:underline dark:text-budi-primary-400"
                      >
                        {r.folio}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <ServiceTypeBadge serviceType={r.service_type || 'tow'} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">{r.zone ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">
                      {r.cubierto == null ? '—' : money(Number(r.cubierto))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <SlaPill met={r.arrival_met} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-500">
                      {new Date(r.created_at).toLocaleDateString('es-SV', { timeZone: 'America/El_Salvador' })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/portal/${r.folio}`} className="inline-flex text-zinc-400 hover:text-zinc-600">
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{value}</p>
    </div>
  );
}
