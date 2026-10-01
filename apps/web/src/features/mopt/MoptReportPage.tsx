'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { duration, formatDateTime, money } from '@/shared/lib/format';
import { serviceTypeLabel } from '@/shared/components/ServiceTypeBadge';
import { svToday } from '@/shared/components/LedgerPaymentModals';

// MOPT-06 (00134): el reporte oficial de un mes, pensado para imprimir o
// guardar en PDF (el marco del portal se oculta al imprimir). Si el mes ya
// cerró se muestra la foto enviada; el mes en curso, en vivo; un mes pasado
// sin foto, recalculado.

type Report = {
  program: string;
  month: string;
  snapshot: boolean;
  generated_at: string;
  email_status?: string | null;
  compliance: {
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
  cost: { services: number; platform_fee: number; total: number };
  contract: { reference: string; monthly_cap: number | null; used_pct: number | null } | null;
  annex: {
    folio: string | null; completed_at: string; service_type: string; zone: string; km: number | null; cost: number | null;
    operator: string | null; assignment_met: boolean | null; arrival_met: boolean | null;
  }[];
};

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Number(v)}%`);
/** 'YYYY-MM' -> "septiembre 2026" (el encabezado del reporte va con el mes completo). */
const longMonth = (m: string) =>
  `${new Intl.DateTimeFormat('es-SV', { timeZone: 'UTC', month: 'long' }).format(new Date(`${m}-01T12:00:00Z`))} ${m.slice(0, 4)}`;
const mins = (s: number | null) => (s == null ? '—' : duration(Number(s) / 60));
const yesNo = (v: boolean | null) => (v == null ? '—' : v ? 'Sí' : 'No');

export default function MoptReportPage({ month }: { month: string }) {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .rpc('mopt_report', { p_month: month })
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setR(data as unknown as Report);
      });
  }, [month]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!r) return <p className="text-sm text-zinc-500">Cargando…</p>;
  const c = r.compliance;

  return (
    <article className="space-y-6 text-zinc-900 dark:text-zinc-100 print:text-black">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/mopt/reportes" className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400">
          <ArrowLeft className="h-4 w-4" /> Reportes
        </Link>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          <Printer className="h-4 w-4" /> Imprimir o guardar PDF
        </button>
      </div>

      <header className="border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <p className="text-xs uppercase tracking-wide text-zinc-500">Budi · Reporte mensual del programa</p>
        <h1 className="font-heading text-2xl font-bold">{r.program}</h1>
        <p className="text-sm capitalize text-zinc-600 dark:text-zinc-400 print:text-zinc-700">
          {longMonth(r.month)} ·{' '}
          <span className="normal-case">
            {r.snapshot
              ? `reporte oficial generado el ${formatDateTime(r.generated_at)}`
              : r.month === svToday().slice(0, 7)
                ? 'mes en curso: cifras en vivo, no oficiales'
                : 'sin reporte oficial · cifras recalculadas, no oficiales'}
          </span>
        </p>
      </header>

      <section>
        <h2 className="mb-2 font-semibold">1. Resumen ejecutivo</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Servicios completados', String(c.completed)],
            ['Asignación a tiempo', pct(c.assignment_met_pct)],
            ['Llegada a tiempo', pct(c.on_time_pct)],
            ['Km recorridos', Number(c.km_total).toLocaleString('es-SV', { maximumFractionDigits: 1 })],
            ['Asignación promedio', mins(c.avg_assignment_seconds)],
            ['Llegada promedio', mins(c.avg_arrival_seconds)],
            ['Costo del mes', money(r.cost.total)],
            ['Uso del tope', r.contract?.used_pct != null ? `${r.contract.used_pct}%` : 'Sin tope'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 print:border-zinc-300">
              <dt className="text-xs text-zinc-500">{k}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {c.targets && (
          <p className="mt-2 text-xs text-zinc-500">
            Objetivos del contrato: asignación en {c.targets.assignment_minutes} min y llegada en {c.targets.arrival_minutes} min.
            {r.contract ? ` Contrato ${r.contract.reference}.` : ''}
          </p>
        )}
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold">2. Por tipo de servicio</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {c.by_service.length === 0 ? <tr><td className="py-1.5 text-zinc-500">Sin servicios.</td></tr> : c.by_service.map((s) => (
                <tr key={s.service_type}><td className="py-1.5">{serviceTypeLabel(s.service_type)}</td><td className="py-1.5 text-right tabular-nums">{s.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">3. Por zona</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {c.by_zone.length === 0 ? <tr><td className="py-1.5 text-zinc-500">Sin servicios.</td></tr> : c.by_zone.map((z) => (
                <tr key={z.zone}><td className="py-1.5">{z.zone}</td><td className="py-1.5 text-right tabular-nums">{z.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">4. Costo</h2>
        <table className="w-full max-w-md text-sm">
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <tr><td className="py-1.5">Servicios (pagados a los socios operadores)</td><td className="py-1.5 text-right tabular-nums">{money(r.cost.services)}</td></tr>
            <tr><td className="py-1.5">Tarifa de la plataforma Budi</td><td className="py-1.5 text-right tabular-nums">{money(r.cost.platform_fee)}</td></tr>
            <tr className="font-semibold"><td className="py-1.5">Total del mes</td><td className="py-1.5 text-right tabular-nums">{money(r.cost.total)}</td></tr>
            {r.contract?.monthly_cap != null && (
              <tr><td className="py-1.5 text-zinc-500">Tope mensual del contrato</td><td className="py-1.5 text-right tabular-nums text-zinc-500">{money(r.contract.monthly_cap)}</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="break-before-page">
        <h2 className="mb-2 font-semibold">Anexo · Servicios del mes ({r.annex.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left uppercase text-zinc-500">
              <tr>
                <th className="py-2 pr-2">Folio</th><th className="py-2 pr-2">Fecha</th><th className="py-2 pr-2">Servicio</th>
                <th className="py-2 pr-2">Zona</th><th className="py-2 pr-2 text-right">Km</th><th className="py-2 pr-2 text-right">Costo</th>
                <th className="py-2 pr-2">Socio operador</th><th className="py-2 pr-2">Asig. a tiempo</th><th className="py-2">Llegada a tiempo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {r.annex.length === 0 ? (
                <tr><td colSpan={9} className="py-3 text-zinc-500">Sin servicios en el mes.</td></tr>
              ) : r.annex.map((a, i) => (
                <tr key={a.folio ?? i} className="break-inside-avoid">
                  <td className="py-1.5 pr-2 font-mono">{a.folio ?? '—'}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{formatDateTime(a.completed_at)}</td>
                  <td className="py-1.5 pr-2">{serviceTypeLabel(a.service_type)}</td>
                  <td className="py-1.5 pr-2">{a.zone}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{a.km == null ? '—' : Number(a.km).toLocaleString('es-SV')}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{a.cost == null ? '—' : money(a.cost)}</td>
                  <td className="py-1.5 pr-2">{a.operator ?? '—'}</td>
                  <td className="py-1.5 pr-2">{yesNo(a.assignment_met)}</td>
                  <td className="py-1.5">{yesNo(a.arrival_met)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Sin datos personales de los Usuarios (Decreto 144). El detalle de cada caso está en el portal, en Servicios.
        </p>
      </section>
    </article>
  );
}
