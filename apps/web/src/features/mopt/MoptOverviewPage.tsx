'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/shared/lib/supabase/client';
import { money } from '@/shared/lib/format';
import { Stat, useMoptCanPay } from './MoptShell';
import { ContractCard } from '@/features/contracts/ContractCard';
import { StaleAlert } from './StaleAlert';

type Overview = {
  program_name: string;
  fee_rate: number;
  operators_total: number;
  operators_approved: number;
  zones_active: number;
  in_progress: number;
  completed_month: number;
  amount_month: number;
  owed_to_operators: number;
  overpaid_operators?: number;
  owed_to_budi: number;
  // 00155: socios con un servicio abierto y sin GPS reciente.
  stale_on_service?: { operator_id: string; full_name: string | null; phone: string | null; request_id: string; folio: string | null; last_seen: string | null }[];
};

export default function MoptOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Hora de la carga, para el "visto hace…" de la alerta (sin Date.now() en el render).
  const [loadedAt, setLoadedAt] = useState(0);
  const canPay = useMoptCanPay();

  useEffect(() => {
    createClient()
      .rpc('mopt_overview')
      .then(({ data: d, error: e }) => {
        if (e) setError(e.message);
        else {
          setData(d as unknown as Overview);
          setLoadedAt(Date.now());
        }
      });
  }, []);

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">No se pudo cargar el resumen: {error}</p>;
  if (!data) return <p className="text-sm text-zinc-500">Cargando…</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">{data.program_name}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Asistencia vial sin costo para el Usuario, atendida por tu flota. Tú les pagas a tus socios operadores.
        </p>
      </div>

      {(data.stale_on_service?.length ?? 0) > 0 && (
        <StaleAlert
          now={loadedAt}
          rows={data.stale_on_service!.map((r) => ({
            operator_id: r.operator_id,
            full_name: r.full_name,
            phone: r.phone,
            updated_at: r.last_seen,
            active_request_id: r.request_id,
            active_folio: r.folio,
          }))}
        />
      )}

      {/* MOPT-05 (00124): contrato y consumo del Fondo Vial del mes. */}
      <ContractCard />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="En curso ahora" value={String(data.in_progress)} />
        <Stat label="Completados este mes" value={String(data.completed_month)} sub={`${money(data.amount_month)} en servicios`} />
        <Stat label="Socios operadores" value={String(data.operators_total)} sub={`${data.operators_approved} verificados`} />
        <Stat label="Zonas activas" value={String(data.zones_active)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500">Pendiente de pagar a tus socios operadores</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-zinc-900 dark:text-white">{money(data.owed_to_operators)}</p>
          {/* 00154: un socio pagado de más (Budi ajustó un caso ya pagado) va aparte. */}
          {Number(data.overpaid_operators ?? 0) > 0 && (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">Pagado de más a algún socio: {money(Number(data.overpaid_operators))}</p>
          )}
          <Link href="/mopt/operadores" className="mt-3 inline-block text-sm font-medium text-budi-primary-600 hover:text-budi-primary-700 dark:text-budi-primary-400">
            {canPay ? 'Ver saldos y registrar pagos →' : 'Ver saldos →'}
          </Link>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500">Tarifa de plataforma Budi</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-zinc-900 dark:text-white">{Number(data.fee_rate)}%</p>
          <p className="mt-3 text-sm text-zinc-500">
            {/* Lo pendiente se muestra aunque hoy la tarifa sea 0 %: puede venir de meses anteriores. */}
            {Number(data.fee_rate) > 0 || Number(data.owed_to_budi) > 0
              ? `Pendiente con Budi: ${money(data.owed_to_budi)}`
              : 'Sin tarifa por servicio configurada.'}
          </p>
        </div>
      </div>
    </div>
  );
}
