'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, FileSignature } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { formatDate, money } from '@/shared/lib/format';
import { ON_CAP_LABEL, budgetBar, budgetMessage, type ContractStatus } from './contract-types';

// Ficha del contrato y consumo del Fondo Vial del mes (migr. 00124, MOPT-05).
// Sin `organizationId` muestra la de quien mira (portal); con él, la de esa
// organización (admin).

const TONE: Record<string, string> = {
  ok: 'bg-budi-primary-500',
  warning: 'bg-amber-500',
  reached: 'bg-red-600',
  none: 'bg-zinc-300',
};

export function ContractCard({ organizationId, refreshKey = 0 }: { organizationId?: string; refreshKey?: number }) {
  const [s, setS] = useState<ContractStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    createClient()
      .rpc('org_contract_status', organizationId ? { p_org: organizationId } : {})
      .then(({ data, error: e }) => {
        if (!alive) return;
        setError(e?.message ?? null);
        setS(data as unknown as ContractStatus);
      });
    return () => {
      alive = false;
    };
  }, [organizationId, refreshKey]);

  if (error) return <p className="text-sm text-red-600">No se pudo cargar el contrato: {error}</p>;
  if (!s) return null;

  if (!s.has_contract)
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500 dark:border-zinc-700">
        <FileSignature className="mb-1 h-5 w-5 text-zinc-400" />
        {s.organization?.type === 'INSURER'
          ? 'Todavía no hay un contrato cargado.'
          : 'Todavía no hay un contrato cargado. Mientras tanto, la cortesía funciona por zona y horario, sin tope.'}
      </div>
    );

  const bar = budgetBar(s);
  const msg = budgetMessage(s);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-white">
            <FileSignature className="h-4 w-4 text-zinc-400" /> Contrato {s.reference ?? ''}
          </h2>
          <p className="text-sm text-zinc-500">
            Vigente del {formatDate(s.valid_from)} {s.valid_to ? `al ${formatDate(s.valid_to)}` : 'sin fecha de fin'}
            {!s.active && <span className="ml-2 font-medium text-red-600">· no vigente hoy</span>}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-zinc-500">SLA asignación</dt>
          <dd className="text-right tabular-nums text-zinc-900 dark:text-white">{s.sla_assignment_minutes ?? 10} min</dd>
          <dt className="text-zinc-500">SLA llegada</dt>
          <dd className="text-right tabular-nums text-zinc-900 dark:text-white">{s.sla_arrival_minutes ?? 45} min</dd>
          {s.platform_fee_pct != null && (
            <>
              <dt className="text-zinc-500">Tarifa de plataforma</dt>
              <dd className="text-right tabular-nums text-zinc-900 dark:text-white">{Number(s.platform_fee_pct)}%</dd>
            </>
          )}
        </dl>
      </div>

      {s.monthly_cap != null && s.consumed != null && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Fondo Vial MOPT · consumo del mes</span>
            <span className="font-medium tabular-nums text-zinc-900 dark:text-white">
              {money(Number(s.consumed))} de {money(Number(s.monthly_cap))} ({Number(s.consumed_pct ?? 0)}%)
            </span>
          </div>
          <div
            className="relative h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={bar.width}
            aria-label="Consumo del tope mensual"
          >
            <div className={`h-full ${TONE[bar.tone]}`} style={{ width: `${bar.width}%` }} />
            {/* Marca del 80 %: donde empieza el aviso. */}
            <div className="absolute inset-y-0 w-px bg-zinc-400 dark:bg-zinc-500" style={{ left: '80%' }} aria-hidden="true" />
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Al llegar al tope: {s.on_cap ? ON_CAP_LABEL[s.on_cap] : '—'}.
          </p>
        </div>
      )}

      {msg && (
        <p
          className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
            s.level === 'reached' || !s.active
              ? 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-200'
              : 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
          }`}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {msg}
        </p>
      )}

      {s.tariff_notes && <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">Tarifas pactadas: {s.tariff_notes}</p>}
    </section>
  );
}
