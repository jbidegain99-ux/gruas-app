'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Info } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { opsAlerts, urgentCount, type OpsAlertsSummary } from '@/features/admin/ops-alerts';

const POLL_MS = 60_000;

/**
 * Aviso fijo arriba del panel con lo que necesita atención ya (00117): el
 * personal no usa la app móvil, así que el push de "solicitud sin atender"
 * no le llegaba. Se consulta cada minuto y el título de la pestaña muestra
 * cuántos avisos urgentes hay, para verlo aunque el panel esté en segundo plano.
 */
export function OpsAlertsBar() {
  const [summary, setSummary] = useState<OpsAlertsSummary | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await createClient().rpc('staff_ops_alerts');
      if (alive && !error) setSummary(data as unknown as OpsAlertsSummary);
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const alerts = opsAlerts(summary);
  const urgent = urgentCount(alerts);

  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = urgent > 0 ? `(${urgent}) ${base}` : base;
  }, [urgent]);

  if (alerts.length === 0) return null;

  return (
    <div role="status" aria-live="polite" className="mb-6 space-y-2 print:hidden">
      {alerts.map((a) => {
        const urgente = a.level === 'urgent';
        const Icon = urgente ? AlertTriangle : Info;
        const cls = urgente
          ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200'
          : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200';
        return (
          <div key={a.key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{a.text}</span>
            {a.href && (
              <Link href={a.href} className="shrink-0 font-semibold underline">
                Ver
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
