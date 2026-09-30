'use client';

import { useEffect, useState } from 'react';
import { Receipt } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { VoidPaymentModal } from '@/shared/components/LedgerPaymentModals';
import { formatDate, money } from '@/shared/lib/format';
import { useMoptCanPay } from './MoptShell';

// mopt_list_payments (00099) devuelve como mucho los 200 más recientes.
const PAYMENTS_LIMIT = 200;

type Row = {
  id: string;
  payee_id: string;
  payee_name: string | null;
  amount: number;
  paid_on: string;
  reference: string | null;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
};

export default function MoptPaymentsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<Row | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const canPay = useMoptCanPay();

  useEffect(() => {
    let alive = true;
    createClient()
      .rpc('mopt_list_payments')
      .then(({ data, error: e }) => {
        if (!alive) return;
        setError(e?.message ?? null);
        setRows((data as Row[]) ?? []);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Pagos</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Los pagos que registraste a tus socios operadores. Un pago mal cargado se anula con su motivo; no se borra.
        </p>
      </div>

      {!loading && !error && rows.length >= PAYMENTS_LIMIT && (
        <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Se muestran los {PAYMENTS_LIMIT} pagos más recientes. Los anteriores siguen en los estados de cuenta.
        </p>
      )}

      {canPay && voiding && (
        <VoidPaymentModal
          paymentId={voiding.id}
          description={`Pago de ${money(Number(voiding.amount))} a ${voiding.payee_name ?? 'socio operador'} del ${formatDate(voiding.paid_on)}`}
          onClose={() => setVoiding(null)}
          onSaved={() => {
            setVoiding(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium">Socio operador</th>
              <th className="px-4 py-3 font-medium">Referencia</th>
              <th className="px-4 py-3 text-right font-medium">Monto</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">Cargando…</td></tr>
            ) : error ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-red-600 dark:text-red-400">No se pudieron cargar los pagos: {error}</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-zinc-500">
                  <Receipt className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
                  {canPay ? 'Todavía no registraste pagos. Se registran desde Socios operadores.' : 'Todavía no hay pagos registrados.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className={r.voided_at ? 'text-zinc-400' : ''}>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDate(r.paid_on)}</td>
                  <td className="px-4 py-3">{r.payee_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    {r.reference ?? '—'}
                    {r.note && <p className="text-xs text-zinc-500">{r.note}</p>}
                    {r.voided_at && <p className="text-xs text-red-600 dark:text-red-400">Anulado: {r.void_reason}</p>}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${r.voided_at ? 'line-through' : 'font-medium text-zinc-900 dark:text-white'}`}>
                    {money(Number(r.amount))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canPay && !r.voided_at && (
                      <button onClick={() => setVoiding(r)} className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400">
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
