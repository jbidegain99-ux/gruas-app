'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/shared/lib/supabase/client';
import { fetchAll } from '@/shared/lib/fetch-all';
import { useConfirm, useToast } from '@/shared/components/FeedbackProvider';
import { formatDateTime, money } from '@/shared/lib/format';
import { serviceTypeLabel } from '@/shared/components/ServiceTypeBadge';
import { useInsurersEnabled } from '@/shared/lib/use-platform-features';

// Cobros a Usuarios (migr. 00133, LAN-07): servicios particulares y copagos.
// El socio confirma el efectivo desde la app; aquí se revisa, se registra un
// pago por otra vía (transferencia) y se anula uno mal confirmado. El efectivo
// confirmado se descuenta de la liquidación del socio.

type Row = {
  id: string; request_id: string; folio: string | null; completed_at: string; service_type: string;
  user_name: string | null; operator_name: string | null; amount: number; status: 'pending' | 'paid' | 'void';
  method: 'cash' | 'card' | 'transfer' | null; paid_at: string | null; receipt_number: string | null;
  note: string | null; void_reason: string | null;
};

const STATUS: Record<Row['status'], { label: string; cls: string }> = {
  pending: { label: 'Pendiente', cls: 'text-amber-700 dark:text-amber-400' },
  paid: { label: 'Pagado', cls: 'text-emerald-700 dark:text-emerald-400' },
  void: { label: 'Anulado', cls: 'text-zinc-500' },
};
const METHOD: Record<NonNullable<Row['method']>, string> = { cash: 'Efectivo al socio', card: 'Tarjeta', transfer: 'Transferencia' };
const input = 'mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';
const card = 'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function AdminCollectionsPage() {
  const toast = useToast();
  // Aseguradoras en pausa (00153): no se habla de copagos.
  const insurers = useInsurersEnabled();
  const confirm = useConfirm();
  const [range, setRange] = useState(() => {
    const to = new Date();
    return { from: iso(new Date(to.getTime() - 30 * 86400e3)), to: iso(to) };
  });
  const [status, setStatus] = useState<'' | Row['status']>('');
  const [rows, setRows] = useState<Row[] | null>(null);
  // Si la consulta falla, se dice en la tabla (antes quedaba "Cargando…").
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<{ id: string; kind: 'void' | 'record'; text: string; method: 'cash' | 'transfer' } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((k) => k + 1), []);

  useEffect(() => {
    // Por tandas: con más de 1000 cobros en el período (max_rows) la lista y
    // sus totales se quedaban cortos.
    const supabase = createClient();
    fetchAll((from, to) =>
      supabase
        .rpc('admin_service_payments', { p_from: range.from, p_to: range.to, p_status: status || null } as never)
        .order('completed_at', { ascending: false })
        .order('id')
        .range(from, to)
    ).then(({ data, error }) => {
        if (error) {
          toast.error(error.message);
          setLoadError(error.message);
          setRows([]);
        } else {
          setLoadError(null);
          setRows((data as unknown as Row[]) ?? []);
        }
      });
  }, [range, status, refresh, toast]);

  const run = async () => {
    if (!action) return;
    if (action.kind === 'void') {
      const ok = await confirm({
        title: '¿Anular este cobro?',
        message: 'Si era efectivo, deja de descontarse de la liquidación del socio.',
        confirmLabel: 'Anular',
        destructive: true,
      });
      if (!ok) return;
    }
    const { error } =
      action.kind === 'void'
        ? await createClient().rpc('admin_void_service_payment', { p_id: action.id, p_reason: action.text })
        : await createClient().rpc('admin_record_service_payment', { p_id: action.id, p_method: action.method, p_note: action.text });
    if (error) return toast.error(error.message);
    toast.success(action.kind === 'void' ? 'Cobro anulado.' : 'Pago registrado.');
    setAction(null);
    reload();
  };

  const pending = (rows ?? []).filter((r) => r.status === 'pending');
  const paid = (rows ?? []).filter((r) => r.status === 'paid');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Cobros a Usuarios</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Lo que pagan los Usuarios por servicios particulares{insurers ? ' y copagos' : ''}. El socio confirma el efectivo desde la app y el
          Usuario recibe su comprobante (no es factura). El pago con tarjeta se habilita al conectar la pasarela.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Desde<input type="date" className={`${input} block`} value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></label>
        <label className="text-sm">Hasta<input type="date" className={`${input} block`} value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></label>
        <label className="text-sm">Estado
          <select className={`${input} block`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">Todos</option>
            <option value="pending">Pendientes</option>
            <option value="paid">Pagados</option>
            <option value="void">Anulados</option>
          </select>
        </label>
        {rows && (
          <p className="pb-2 text-sm text-zinc-600 dark:text-zinc-400">
            {pending.length} pendiente(s) por {money(pending.reduce((a, r) => a + Number(r.amount), 0))} · cobrado{' '}
            {money(paid.reduce((a, r) => a + Number(r.amount), 0))}
          </p>
        )}
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Servicio</th><th className="px-4 py-3">Usuario · socio</th>
              <th className="px-4 py-3 text-right">Monto</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows === null ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">Cargando…</td></tr>
            ) : loadError ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-red-600 dark:text-red-400">No se pudieron cargar los cobros: {loadError}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">Sin cobros en el período.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-4 py-3">
                  <p className="font-mono text-xs">{r.folio ?? '—'}</p>
                  <p className="text-xs text-zinc-500">{serviceTypeLabel(r.service_type)} · {formatDateTime(r.completed_at)}</p>
                </td>
                <td className="px-4 py-3">
                  <p>{r.user_name ?? '—'}</p>
                  <p className="text-xs text-zinc-500">{r.operator_name ?? '—'}</p>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{money(Number(r.amount))}</td>
                <td className="px-4 py-3">
                  <p className={STATUS[r.status].cls}>{STATUS[r.status].label}</p>
                  <p className="text-xs text-zinc-500">
                    {r.method ? METHOD[r.method] : ''}
                    {r.receipt_number ? ` · ${r.receipt_number}` : ''}
                    {r.paid_at ? ` · ${formatDateTime(r.paid_at)}` : ''}
                  </p>
                  {(r.note || r.void_reason) && <p className="text-xs text-zinc-500">{r.void_reason ?? r.note}</p>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {r.status === 'pending' && (
                    <button onClick={() => setAction({ id: r.id, kind: 'record', text: '', method: 'transfer' })} className="text-xs font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                      Registrar pago
                    </button>
                  )}
                  {r.status !== 'void' && (
                    <button onClick={() => setAction({ id: r.id, kind: 'void', text: '', method: 'transfer' })} className="ml-3 text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                      Anular
                    </button>
                  )}
                  {action?.id === r.id && (
                    <div className="mt-2 flex flex-wrap items-end justify-end gap-2 text-left">
                      {action.kind === 'record' && (
                        <label className="text-xs">Método
                          <select className={`${input} block`} value={action.method} onChange={(e) => setAction({ ...action, method: e.target.value as 'cash' | 'transfer' })}>
                            <option value="transfer">Transferencia a Budi</option>
                            <option value="cash">Efectivo al socio</option>
                          </select>
                        </label>
                      )}
                      <label className="text-xs">{action.kind === 'void' ? 'Motivo' : 'Cómo se confirmó'}
                        <input className={`${input} block w-56`} value={action.text} onChange={(e) => setAction({ ...action, text: e.target.value })} />
                      </label>
                      <button onClick={run} disabled={!action.text.trim()} className="rounded-lg bg-budi-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-budi-primary-700 disabled:opacity-50">
                        Guardar
                      </button>
                      <button onClick={() => setAction(null)} className="rounded-lg border border-zinc-300 px-3 py-2 text-xs dark:border-zinc-700">Cancelar</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
