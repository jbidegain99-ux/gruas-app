'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { formatDateTime } from '@/shared/lib/format';
import { monthLabel } from '@/features/admin/account-360';
import { svToday } from '@/shared/components/LedgerPaymentModals';

// MOPT-06 (00134): reportes mensuales oficiales. El día 1 se genera la foto del
// mes anterior y se envía por correo a dueño y administradores; aquí están
// todos, más el mes en curso calculado en vivo.

type Row = { month: string; services: number; generated_at: string | null; email_status: string | null };

export default function MoptReportsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Solo el mes en curso (hora de El Salvador) se calcula en vivo; un mes
  // pasado sin foto es uno cuyo reporte no se generó.
  const mesActual = svToday().slice(0, 7);

  useEffect(() => {
    createClient()
      .rpc('mopt_reports_list')
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setRows((data as Row[]) ?? []);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Reportes mensuales</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          El día 1 de cada mes se genera el reporte oficial del mes anterior (resumen ejecutivo y anexo de servicios) y
          se envía por correo al dueño y a los administradores del portal. Ábrelo para imprimirlo o guardarlo en PDF.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {rows === null && !error && <li className="px-4 py-6 text-center text-sm text-zinc-500">Cargando…</li>}
        {rows?.map((r) => (
          <li key={r.month}>
            <Link href={`/mopt/reportes/${r.month}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-zinc-400" />
                <span className="font-medium capitalize text-zinc-900 dark:text-white">{monthLabel(`${r.month}-01`, true)}</span>
                <span className="text-sm text-zinc-500">{Number(r.services)} servicio(s)</span>
              </span>
              <span className="text-xs text-zinc-500">
                {r.generated_at
                  ? `Reporte oficial del ${formatDateTime(r.generated_at)}${r.email_status === 'enviado' ? ' · enviado por correo' : ''}`
                  : r.month === mesActual
                    ? 'En curso (en vivo)'
                    : 'Sin reporte oficial · cifras recalculadas'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
