'use client';

import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';

// B-15: SLA del caso, tal como lo devuelve get_case_sla().
type Sla = {
  folio: string;
  insurer_name: string | null;
  assignment_seconds: number | null;
  arrival_seconds: number | null;
  service_seconds: number | null;
  assignment_target_minutes: number;
  arrival_target_minutes: number;
  assignment_met: boolean | null;
  arrival_met: boolean | null;
};

function fmtDur(secs: number | null): string {
  if (secs == null) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  if (m === 0) return `${s} s`;
  if (m < 60) return s > 0 ? `${m} min ${s} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

function Chip({ met }: { met: boolean | null }) {
  if (met === null)
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        Pendiente
      </span>
    );
  return met ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
      En tiempo
    </span>
  ) : (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">
      Fuera de SLA
    </span>
  );
}

/**
 * Resumen de SLA del caso: los tiempos reales de cada tramo y si entraron en el
 * objetivo de la aseguradora (o el de la plataforma para un servicio particular).
 * La duración del servicio se muestra como dato, sin objetivo — el SLA que se
 * pacta es el de respuesta (asignar y llegar).
 */
export function CaseSla({ folio }: { folio: string | null }) {
  const [sla, setSla] = useState<Sla | null>(null);
  const [loadedFolio, setLoadedFolio] = useState<string | null>(null);
  const loading = folio != null && folio !== loadedFolio;

  useEffect(() => {
    if (!folio) return;
    let alive = true;
    createClient()
      .rpc('get_case_sla', { p_folio: folio })
      .then(({ data }) => {
        if (!alive) return;
        setSla((data as Sla) ?? null);
        setLoadedFolio(folio);
      });
    return () => {
      alive = false;
    };
  }, [folio]);

  if (!folio) return null;

  return (
    <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-zinc-400" />
        <p className="text-sm font-semibold text-zinc-900 dark:text-white">Cumplimiento de SLA</p>
      </div>

      {loading || !sla ? (
        <p className="text-xs text-zinc-500">Cargando…</p>
      ) : (
        <div className="space-y-2">
          <Row
            label="Encontrar operador"
            value={fmtDur(sla.assignment_seconds)}
            target={sla.assignment_target_minutes}
            met={sla.assignment_met}
          />
          <Row
            label="Llegada al lugar"
            value={fmtDur(sla.arrival_seconds)}
            target={sla.arrival_target_minutes}
            met={sla.arrival_met}
          />
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Duración del servicio</span>
            <span className="text-sm tabular-nums text-zinc-900 dark:text-white">
              {fmtDur(sla.service_seconds)}
            </span>
          </div>
          <p className="pt-1 text-xs text-zinc-500">
            {sla.insurer_name
              ? `Objetivos de ${sla.insurer_name}`
              : 'Servicio particular · objetivos de la plataforma'}
          </p>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  target,
  met,
}: {
  label: string;
  value: string;
  target: number;
  met: boolean | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm text-zinc-900 dark:text-white">{label}</p>
        <p className="text-xs text-zinc-500">objetivo: {target} min</p>
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-sm font-medium tabular-nums text-zinc-900 dark:text-white">{value}</span>
        <Chip met={met} />
      </div>
    </div>
  );
}
