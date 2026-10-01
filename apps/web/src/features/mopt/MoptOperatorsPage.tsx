'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { RegisterPaymentModal } from '@/shared/components/LedgerPaymentModals';
import { formatDate, money } from '@/shared/lib/format';
import { useMoptCanPay } from './MoptShell';
import { ratingLabel } from './mopt-fleet';

type Row = {
  operator_id: string;
  full_name: string | null;
  phone: string | null;
  verification_status: string | null;
  in_program: boolean;
  services: number;
  owed: number;
  paid: number;
  balance: number;
  // 00155
  plate: string | null;
  avg_rating: number | null;
  ratings_count: number | null;
  last_paid_on: string | null;
};

const VERIF: Record<string, { label: string; cls: string }> = {
  approved: { label: 'Verificado', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  pending: { label: 'En revisión', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  rejected: { label: 'Rechazado', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
};

export default function MoptOperatorsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [programId, setProgramId] = useState<string | null>(null);
  const [programName, setProgramName] = useState('Programa MOPT');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<Row | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const canPay = useMoptCanPay();

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    Promise.all([supabase.rpc('mopt_list_operators'), supabase.rpc('auth_mopt_id'), supabase.rpc('mopt_overview')]).then(
      ([ops, id, ov]) => {
        if (!alive) return;
        setError(ops.error?.message ?? null);
        setRows((ops.data as Row[]) ?? []);
        setProgramId((id.data as string | null) ?? null);
        setProgramName((ov.data as { program_name?: string } | null)?.program_name ?? 'Programa MOPT');
        setLoading(false);
      }
    );
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  // Un socio pagado de más (saldo negativo) no le resta a lo que se les debe a los demás.
  const totalPendiente = rows.reduce((a, r) => a + Math.max(0, Number(r.balance)), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Socios operadores</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Tu flota y lo que le debes a cada uno. El alta y la verificación de identidad las hace Budi.{' '}
            <Link href="/mopt/pagos" className="font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
              Ver pagos registrados →
            </Link>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500">Pendiente total</p>
          <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{loading || error ? '—' : money(totalPendiente)}</p>
        </div>
      </div>

      {canPay && paying && programId && (
        <RegisterPaymentModal
          payer={{ kind: 'mopt', id: programId, name: programName }}
          payee={{ kind: 'operator', id: paying.operator_id, name: paying.full_name || 'Socio operador' }}
          balance={Number(paying.balance)}
          onClose={() => setPaying(null)}
          onSaved={() => {
            setPaying(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">Socio operador</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 text-right font-medium">Servicios</th>
              <th className="px-4 py-3 text-right font-medium">Generado</th>
              <th className="px-4 py-3 text-right font-medium">Pagado</th>
              <th className="px-4 py-3 text-right font-medium">Pendiente</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Cargando…</td></tr>
            ) : error ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-red-600 dark:text-red-400">No se pudieron cargar los socios operadores: {error}</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-zinc-500">
                  <Users className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
                  Todavía no hay socios operadores en tu programa. Pídele a Budi que los vincule.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const v = VERIF[r.verification_status ?? ''];
                return (
                  <tr key={r.operator_id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-900 dark:text-white">{r.full_name || 'Sin nombre'}</p>
                      <p className="text-xs text-zinc-500">
                        {r.phone || '—'}
                        {r.in_program && (r.plate ? <span className="ml-2 font-mono">Grúa {r.plate}</span> : <span className="ml-2">Sin grúa registrada</span>)}
                      </p>
                      <p className="text-xs text-zinc-500">{ratingLabel(r.avg_rating, r.ratings_count)}</p>
                    </td>
                    <td className="px-4 py-3">
                      {r.in_program ? (
                        v ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${v.cls}`}>{v.label}</span> : '—'
                      ) : (
                        <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">Ya no está en el programa</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.services}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(Number(r.owed))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(Number(r.paid))}
                      {r.last_paid_on && <p className="text-xs text-zinc-500">último {formatDate(r.last_paid_on)}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">
                      {Number(r.balance) < 0 ? (
                        <span className="text-amber-700 dark:text-amber-300">
                          {money(-Number(r.balance))}
                          <span className="block text-xs font-normal">pagado de más</span>
                        </span>
                      ) : (
                        money(Number(r.balance))
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canPay && Number(r.balance) > 0 && (
                        <button
                          onClick={() => setPaying(r)}
                          className="whitespace-nowrap rounded-lg bg-budi-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-budi-primary-600"
                        >
                          Registrar pago
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
