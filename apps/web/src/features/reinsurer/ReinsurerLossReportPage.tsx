'use client';

import { useEffect, useState } from 'react';
import { Download, Info } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { money } from '@/shared/lib/format';
import { exportMatrix } from '@/shared/lib/export/table-export';
import type { Cell } from '@/shared/lib/export/xlsx';

// REA-03 (00136): siniestralidad trimestral por aseguradora cedente, contra el
// trimestre anterior. Formato provisional, a validar con una reaseguradora.

type LossCell =
  | { suppressed: true; exposure: number }
  | { suppressed: false; services: number; exposure: number; cost: number; frequency_per_1000: number | null;
      severity: number; cost_per_member: number | null };
type Row = {
  insurer: string; current: LossCell; previous: LossCell;
  change_pct: { services: number | null; frequency_per_1000: number | null; severity: number | null; cost: number | null };
};
type Report = {
  min_cell: number;
  quarter: { year: number; quarter: number; from: string; to: string };
  previous: { year: number; quarter: number };
  by_insurer: Row[];
  total: { services: number; cost: number; exposure: number; suppressed_insurers: number };
};

const input = 'mt-1 block rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';
const card = 'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';
const num = (n: number | null | undefined, d = 2) => (n == null ? '—' : Number(n).toLocaleString('es-SV', { maximumFractionDigits: d }));
const chg = (n: number | null) => (n == null ? '—' : `${n > 0 ? '+' : ''}${num(n, 1)} %`);

/** El último trimestre completo. */
function lastQuarter(today = new Date()): { year: number; quarter: number } {
  const q = Math.floor(today.getMonth() / 3) + 1;
  return q === 1 ? { year: today.getFullYear() - 1, quarter: 4 } : { year: today.getFullYear(), quarter: q - 1 };
}

export default function ReinsurerLossReportPage() {
  const [sel, setSel] = useState(lastQuarter);
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .rpc('reinsurer_loss_report', { p_year: sel.year, p_quarter: sel.quarter })
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else {
          setError(null);
          setR(data as unknown as Report);
        }
      });
  }, [sel]);

  const exportXlsx = () => {
    if (!r) return;
    const s = (c: LossCell, k: 'services' | 'cost' | 'frequency_per_1000' | 'severity' | 'cost_per_member'): Cell =>
      c.suppressed ? (k === 'services' ? `< ${r.min_cell}` : null) : c[k];
    const matrix: Cell[][] = [
      [`Budi · Siniestralidad T${r.quarter.quarter} ${r.quarter.year} contra T${r.previous.quarter} ${r.previous.year} (formato provisional). Celdas con menos de ${r.min_cell} servicios no se publican.`],
      [],
      ['Aseguradora', 'Afiliados expuestos', 'Servicios', 'Frecuencia por 1 000', 'Severidad (USD)', 'Costo por afiliado (USD)',
       'Costo total (USD)', 'Servicios T ant.', 'Severidad T ant.', 'Var. servicios %', 'Var. frecuencia %', 'Var. severidad %', 'Var. costo %'],
      ...r.by_insurer.map((x) => [
        x.insurer, x.current.exposure, s(x.current, 'services'), s(x.current, 'frequency_per_1000'), s(x.current, 'severity'),
        s(x.current, 'cost_per_member'), s(x.current, 'cost'), s(x.previous, 'services'), s(x.previous, 'severity'),
        x.change_pct.services, x.change_pct.frequency_per_1000, x.change_pct.severity, x.change_pct.cost,
      ]),
    ];
    exportMatrix(matrix, 'xlsx', `siniestralidad-${r.quarter.year}-T${r.quarter.quarter}`);
  };

  const years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Siniestralidad trimestral</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Frecuencia, severidad y costo por afiliado de cada aseguradora cedente, contra el trimestre anterior.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Año
            <select className={input} value={sel.year} onChange={(e) => setSel({ ...sel, year: Number(e.target.value) })}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="text-sm">Trimestre
            <select className={input} value={sel.quarter} onChange={(e) => setSel({ ...sel, quarter: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>T{q}</option>)}
            </select>
          </label>
          <button onClick={exportXlsx} disabled={!r} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            <Download className="h-4 w-4" /> Excel
          </button>
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-lg bg-zinc-100 p-3 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        Formato provisional: lo ajustamos con tu equipo. Exposición = afiliados vigentes en algún momento del trimestre;
        severidad = costo cubierto promedio por servicio. Una cifra con menos de {r?.min_cell ?? 5} servicios no se publica.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!r && !error && <p className="text-sm text-zinc-500">Cargando…</p>}

      {r && (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Aseguradora</th>
                <th className="px-4 py-3 text-right">Expuestos</th>
                <th className="px-4 py-3 text-right">Servicios</th>
                <th className="px-4 py-3 text-right">Frec. por 1 000</th>
                <th className="px-4 py-3 text-right">Severidad</th>
                <th className="px-4 py-3 text-right">Costo por afiliado</th>
                <th className="px-4 py-3 text-right">Costo total</th>
                <th className="px-4 py-3 text-right">Var. vs T{r.previous.quarter}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {r.by_insurer.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">Ninguna aseguradora te ha autorizado todavía.</td></tr>
              ) : r.by_insurer.map((x) => (
                <tr key={x.insurer}>
                  <td className="px-4 py-3">{x.insurer}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{num(x.current.exposure, 0)}</td>
                  {x.current.suppressed ? (
                    <td colSpan={6} className="px-4 py-3 text-zinc-500">Menos de {r.min_cell} servicios: no se publica</td>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums">{num(x.current.services, 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(x.current.frequency_per_1000)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(x.current.severity)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{x.current.cost_per_member == null ? '—' : money(x.current.cost_per_member)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(x.current.cost)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                        servicios {chg(x.change_pct.services)}<br />
                        severidad {chg(x.change_pct.severity)}<br />
                        costo {chg(x.change_pct.cost)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            {r.by_insurer.length > 0 && (
              <tfoot className="border-t border-zinc-200 font-semibold dark:border-zinc-800">
                <tr>
                  <td className="px-4 py-3">Total publicado</td>
                  <td className="px-4 py-3 text-right tabular-nums">{num(r.total.exposure, 0)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{num(r.total.services, 0)}</td>
                  <td colSpan={3} />
                  <td className="px-4 py-3 text-right tabular-nums">{money(r.total.cost)}</td>
                  <td className="px-4 py-3 text-right text-xs font-normal text-zinc-500">
                    {r.total.suppressed_insurers > 0 ? `sin ${r.total.suppressed_insurers} suprimida(s)` : ''}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
