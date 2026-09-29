'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { money } from '@/shared/lib/format';
import { serviceTypeLabel } from '@/shared/components/ServiceTypeBadge';
import { tableRows, exportMatrix } from '@/shared/lib/export/table-export';
import { monthLabel } from '@/features/admin/account-360';
import { CONSENT_LABEL, defaultRange, exportColumns, type Cell, type Dashboard } from './reinsurer';

// Tablero consolidado de la reaseguradora (migr. 00131, REA-02): solo cifras
// agregadas de las aseguradoras cedentes que lo autorizaron. Toda celda con
// menos de `min_cell` casos llega suprimida desde la base.

const card = 'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';
const input = 'mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';
const pct = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('es-SV', { maximumFractionDigits: 1 })} %`);

function Row({ label, c, min, perMembers }: { label: string; c: Cell; min: number; perMembers?: boolean }) {
  if (c.suppressed)
    return (
      <tr>
        <td className="px-4 py-2.5">{label}</td>
        <td colSpan={perMembers ? 6 : 5} className="px-4 py-2.5 text-zinc-500">Menos de {min} casos: no se publica</td>
      </tr>
    );
  return (
    <tr>
      <td className="px-4 py-2.5">{label}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{c.services.toLocaleString('es-SV')}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{money(c.cost)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{money(c.avg_cost)}</td>
      {perMembers && (
        <td className="px-4 py-2.5 text-right tabular-nums">{c.per_1000_members == null ? '—' : c.per_1000_members.toLocaleString('es-SV')}</td>
      )}
      <td className="px-4 py-2.5 text-right tabular-nums">{pct(c.assignment_on_time_pct)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{pct(c.arrival_on_time_pct)}</td>
    </tr>
  );
}

function Table({ title, first, rows, min, perMembers }: {
  title: string; first: string; rows: { label: string; c: Cell }[]; min: number; perMembers?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-2 font-semibold text-zinc-900 dark:text-white">{title}</h2>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">{first}</th>
              <th className="px-4 py-3 text-right">Servicios</th>
              <th className="px-4 py-3 text-right">Costo cubierto</th>
              <th className="px-4 py-3 text-right">Promedio</th>
              {perMembers && <th className="px-4 py-3 text-right">Por 1 000 afiliados</th>}
              <th className="px-4 py-3 text-right">Asignación a tiempo</th>
              <th className="px-4 py-3 text-right">Llegada a tiempo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.length === 0 ? (
              <tr><td colSpan={perMembers ? 7 : 6} className="px-4 py-6 text-center text-zinc-500">Sin datos en el período.</td></tr>
            ) : rows.map((r) => <Row key={r.label} label={r.label} c={r.c} min={min} perMembers={perMembers} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ReinsurerDashboardPage() {
  const [range, setRange] = useState(() => defaultRange(new Date()));
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .rpc('reinsurer_dashboard', { p_from: range.from, p_to: range.to })
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else {
          setError(null);
          setD(data as unknown as Dashboard);
        }
      });
  }, [range]);

  const exportAll = () => {
    if (!d) return;
    const m = d.min_cell;
    const matrix = [
      [`Budi · tablero de reaseguro ${d.period.from} a ${d.period.to}. Celdas con menos de ${m} casos no se publican.`],
      [],
      ...tableRows(d.by_insurer, exportColumns('Aseguradora', (r) => r.insurer, m)),
      [],
      ...tableRows(d.by_service, exportColumns('Servicio', (r) => serviceTypeLabel(r.service_type), m)),
      [],
      ...tableRows(d.by_month, exportColumns('Mes', (r) => r.month, m)),
    ];
    exportMatrix(matrix, 'xlsx', `reaseguro-${d.period.from}-${d.period.to}`);
  };

  const granted = d?.cedents.filter((c) => c.consent_status === 'granted').length ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Tablero de reaseguro</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Servicios completados y cubiertos de tus aseguradoras cedentes. Solo cifras agregadas, sin datos personales;
            una cifra con menos de {d?.min_cell ?? 5} casos no se publica.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Desde<input type="date" className={`${input} block`} value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></label>
          <label className="text-sm">Hasta<input type="date" className={`${input} block`} value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></label>
          <button onClick={exportAll} disabled={!d} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            <Download className="h-4 w-4" /> Excel
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!d && !error && <p className="text-sm text-zinc-500">Cargando…</p>}

      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: 'Servicios', value: d.total.services.toLocaleString('es-SV') },
              { label: 'Costo cubierto', value: money(d.total.cost) },
              { label: 'Costo promedio por servicio', value: d.total.avg_cost == null ? '—' : money(d.total.avg_cost) },
            ].map((k) => (
              <div key={k.label} className={`${card} p-4`}>
                <p className="text-xs uppercase tracking-wide text-zinc-500">{k.label}</p>
                <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{k.value}</p>
              </div>
            ))}
          </div>
          {d.total.suppressed_insurers > 0 && (
            <p className="-mt-5 text-xs text-zinc-500">
              Los totales no incluyen {d.total.suppressed_insurers} aseguradora(s) con menos de {d.min_cell} casos en el período.
            </p>
          )}

          <Table title="Por aseguradora cedente" first="Aseguradora" min={d.min_cell} perMembers
                 rows={d.by_insurer.map((r) => ({ label: r.insurer, c: r }))} />
          <Table title="Por tipo de servicio" first="Servicio" min={d.min_cell}
                 rows={d.by_service.map((r) => ({ label: serviceTypeLabel(r.service_type), c: r }))} />
          <Table title="Tendencia mensual" first="Mes" min={d.min_cell}
                 rows={d.by_month.map((r) => ({ label: monthLabel(`${r.month}-01`, true), c: r }))} />

          <section>
            <h2 className="mb-2 font-semibold text-zinc-900 dark:text-white">Aseguradoras cedentes</h2>
            <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
              Cada aseguradora autoriza desde su portal que veas sus agregados. {granted} de {d.cedents.length} lo han autorizado.
            </p>
            <ul className={`${card} divide-y divide-zinc-100 dark:divide-zinc-800`}>
              {d.cedents.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-zinc-500">Budi aún no vincula aseguradoras a tu cuenta.</li>
              ) : d.cedents.map((c) => (
                <li key={c.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="text-zinc-900 dark:text-white">{c.name}</span>
                  <span className={c.consent_status === 'granted' ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-500'}>
                    {CONSENT_LABEL[c.consent_status]} · desde {c.valid_from}{c.valid_to ? ` hasta ${c.valid_to}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
