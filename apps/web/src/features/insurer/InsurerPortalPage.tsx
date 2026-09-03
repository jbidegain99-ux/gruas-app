'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Inbox } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { ServiceTypeBadge } from '@/shared/components/ServiceTypeBadge';
import { StatusBadge } from '@/shared/components/StatusBadge';

// B-17: fila de list_insurer_cases().
type Row = {
  folio: string;
  service_type: string;
  status: string;
  created_at: string;
  total_price: number | null;
  coverage_status: string | null;
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

export default function InsurerPortalPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    createClient()
      .rpc('list_insurer_cases')
      .then(({ data }) => {
        if (!alive) return;
        setRows((data as Row[]) ?? []);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => {
    const total = rows.length;
    const completados = rows.filter((r) => r.status === 'completed').length;
    const conSla = rows.filter((r) => r.arrival_met !== null);
    const enTiempo = conSla.filter((r) => r.arrival_met).length;
    const pct = conSla.length ? Math.round((enTiempo / conSla.length) * 100) : null;
    return { total, completados, pct };
  }, [rows]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Tus casos</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Cada servicio de tus afiliados, con su folio, estado y cumplimiento de SLA.
        </p>
      </div>

      {/* Resumen */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Casos" value={String(stats.total)} />
        <Stat label="Completados" value={String(stats.completados)} />
        <Stat label="Llegada en tiempo" value={stats.pct == null ? '—' : `${stats.pct}%`} />
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wider text-zinc-500 dark:border-zinc-800">
                <th className="px-4 py-3 font-medium">Folio</th>
                <th className="px-4 py-3 font-medium">Servicio</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Llegada (SLA)</th>
                <th className="px-4 py-3 text-right font-medium">Fecha</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-sm text-zinc-500">
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <Inbox className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                    <p className="mt-3 text-sm text-zinc-500">Todavía no hay casos de tus afiliados.</p>
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
                    <td className="whitespace-nowrap px-4 py-3">
                      <SlaPill met={r.arrival_met} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-500">
                      {new Date(r.created_at).toLocaleDateString('es-SV')}
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
