'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { formatDateTime } from '@/shared/lib/format';
import { svToday } from '@/shared/components/LedgerPaymentModals';

// MOPT-06 (00134): reportes mensuales de un programa. El job los genera el día
// 1; aquí el admin ve si salieron por correo y puede regenerar (p. ej. tras
// corregir un servicio) o reenviar.

type Row = { month: string; generated_at: string; email_status: string | null; emailed_to: string[] | null; services: number };

// El mes anterior en hora de El Salvador ('YYYY-MM'): el reporte es de un mes
// cerrado, y con la hora del navegador el día 1 temprano daba otro mes.
const prevMonth = () => {
  const [y, m] = svToday().split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

export function MoptReportsAdmin({ providerId }: { providerId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [month, setMonth] = useState(prevMonth);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const reload = useCallback(() => setRefresh((k) => k + 1), []);

  useEffect(() => {
    createClient()
      .rpc('admin_mopt_reports', { p_mopt: providerId })
      .then(({ data, error }) => {
        setLoadError(error?.message ?? null);
        setRows((data as Row[]) ?? []);
      });
  }, [providerId, refresh]);

  const generate = async (m: string, send: boolean) => {
    setBusy(true);
    const { data, error } = await createClient().rpc('admin_generate_mopt_report', { p_mopt: providerId, p_month: m, p_send: send });
    setBusy(false);
    if (error) return toast.error(error.message);
    const r = data as unknown as { email_status: string | null };
    toast.info(send ? `Reporte ${m}: ${r.email_status ?? 'generado'}.` : `Reporte ${m} regenerado.`);
    reload();
  };

  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold text-zinc-900 dark:text-white">Reportes mensuales</h4>
      <p className="text-xs text-zinc-500">
        Se generan el día 1 y se envían al dueño y administradores del portal. El correo necesita los secretos de Vault
        <code className="mx-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">resend_api_key</code> y
        <code className="mx-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">report_from_email</code>.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          Mes
          <input type="month" value={month} max={prevMonth()} onChange={(e) => setMonth(e.target.value)} className="mt-1 block rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
        </label>
        <button disabled={busy || !month} onClick={() => generate(month, false)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Generar
        </button>
        <button disabled={busy || !month} onClick={() => generate(month, true)} className="rounded-lg bg-budi-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-budi-primary-700 disabled:opacity-50">
          Generar y enviar
        </button>
      </div>
      {loadError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">No se pudieron cargar los reportes: {loadError}</p>}
      {rows.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.month}>
                <td className="py-1.5 font-medium">{r.month}</td>
                <td className="py-1.5 text-zinc-600 dark:text-zinc-400">{r.services} servicio(s)</td>
                <td className="py-1.5 text-xs text-zinc-500">{formatDateTime(r.generated_at)}</td>
                <td className={`py-1.5 text-xs ${r.email_status === 'enviado' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {r.email_status ?? 'sin enviar'}
                  {r.email_status === 'enviado' && r.emailed_to?.length ? ` a ${r.emailed_to.join(', ')}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
