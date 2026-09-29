'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { money } from '@/shared/lib/format';
import { STATUS_LABEL, STATUS_STYLE, periodLabel, type StatementSummary } from './statement-types';

/** Lista de estados de cuenta. El cliente ve los suyos (sin borradores); el admin, todos. */
export function StatementList({ basePath, showOrg = false, refreshKey = 0 }: { basePath: string; showOrg?: boolean; refreshKey?: number }) {
  const [rows, setRows] = useState<StatementSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    createClient()
      .rpc('list_statements', {})
      .then(({ data, error: e }) => {
        if (!alive) return;
        setError(e?.message ?? null);
        setRows((data as unknown as StatementSummary[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (error) return <p className="text-sm text-red-600">No se pudieron cargar: {error}</p>;
  if (!rows) return <p className="text-sm text-zinc-500">Cargando…</p>;
  if (rows.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
        <FileText className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
        Todavía no hay estados de cuenta.
      </div>
    );

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-3">Período</th>
            {showOrg && <th className="px-4 py-3">Cliente</th>}
            <th className="px-4 py-3">Número</th>
            <th className="px-4 py-3">Estado</th>
            <th className="px-4 py-3 text-right">Servicios</th>
            <th className="px-4 py-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((s) => (
            <tr key={s.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              <td className="px-4 py-3">
                <Link href={`${basePath}/${s.id}`} className="font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                  {periodLabel(s.period_from, s.period_to)}
                </Link>
              </td>
              {showOrg && <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{s.organization_name}</td>}
              <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">{s.number ?? '—'}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                {s.totals.observed_open > 0 && (
                  <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">{s.totals.observed_open} observado(s)</span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{s.totals.services}</td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">{money(Number(s.approved_amount ?? s.totals.approvable))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
