'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Landmark } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import {
  RegisterPaymentModal,
  VoidPaymentModal,
  type LedgerParty,
} from '@/shared/components/LedgerPaymentModals';
import { formatDate, money } from '@/shared/lib/format';
import { ledgerPartyUrl } from './account-360';

// Libro de movimientos (migr. 00099). Lo que se debe sale de los servicios
// completados; lo que se paga lo registra una persona. Saldo = debido − pagado.

type Balance = {
  debtor_kind: string;
  debtor_id: string | null;
  debtor_name: string | null;
  creditor_kind: string;
  creditor_id: string | null;
  creditor_name: string | null;
  services: number;
  owed: number;
  paid: number;
  balance: number;
  last_paid_on: string | null;
};

type Payment = {
  id: string;
  payer_kind: string;
  payer_name: string | null;
  payee_kind: string;
  payee_name: string | null;
  amount: number;
  paid_on: string;
  reference: string | null;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
};

const KIND_LABEL: Record<string, string> = {
  budi: 'Budi',
  insurer: 'Aseguradora',
  provider: 'Empresa',
  operator: 'Socio operador independiente',
  mopt: 'Programa MOPT',
  mopt_operator: 'Socio operador de la flota MOPT',
};

const party = (kind: string, id: string | null, name: string | null): LedgerParty => ({
  kind,
  id,
  name: name || KIND_LABEL[kind] || kind,
});

export default function AdminAccountsPage() {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<Balance | null>(null);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [showSettled, setShowSettled] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    Promise.all([supabase.rpc('admin_ledger_balances'), supabase.rpc('admin_ledger_payments', { p_limit: 100 })]).then(
      ([b, p]) => {
        if (!alive) return;
        setError(b.error?.message ?? p.error?.message ?? null);
        setBalances((b.data as Balance[]) ?? []);
        setPayments((p.data as Payment[]) ?? []);
        setLoading(false);
      }
    );
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const refetch = () => setRefreshKey((k) => k + 1);

  const groups = useMemo(() => {
    const visible = balances.filter((b) => showSettled || Number(b.balance) !== 0);
    return {
      budiOwes: visible.filter((b) => b.debtor_kind === 'budi'),
      owedToBudi: visible.filter((b) => b.creditor_kind === 'budi'),
      moptToOperators: visible.filter((b) => b.debtor_kind === 'mopt' && b.creditor_kind === 'operator'),
    };
  }, [balances, showSettled]);

  const sum = (rows: Balance[]) => rows.reduce((a, r) => a + Number(r.balance), 0);
  const totals = {
    budiOwes: sum(balances.filter((b) => b.debtor_kind === 'budi')),
    owedToBudi: sum(balances.filter((b) => b.creditor_kind === 'budi')),
    moptToOperators: sum(balances.filter((b) => b.debtor_kind === 'mopt' && b.creditor_kind === 'operator')),
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Cuentas</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Quién le debe a quién por los servicios completados, cuánto se pagó y cuánto queda. Lo que paga el
            Usuario (particular o copago) se registra en Cobros a Usuarios.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input id="show-settled" type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} />
          Mostrar cuentas saldadas
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi Icon={ArrowUpRight} tint="bg-amber-50 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300" label="Budi debe pagar" value={money(totals.budiOwes)} sub="a empresas y socios operadores independientes" />
        <Kpi Icon={ArrowDownLeft} tint="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300" label="Le deben a Budi" value={money(totals.owedToBudi)} sub="aseguradoras y tarifa de programas MOPT" />
        <Kpi Icon={Landmark} tint="bg-budi-primary-50 text-budi-primary-600 dark:bg-budi-primary-900/40 dark:text-budi-primary-300" label="MOPT debe a sus socios operadores" value={money(totals.moptToOperators)} sub="lo paga el MOPT directo, Budi no media" />
      </div>

      {paying && (
        <RegisterPaymentModal
          payer={party(paying.debtor_kind, paying.debtor_id, paying.debtor_name)}
          payee={party(paying.creditor_kind, paying.creditor_id, paying.creditor_name)}
          balance={Number(paying.balance)}
          onClose={() => setPaying(null)}
          onSaved={() => {
            setPaying(null);
            refetch();
          }}
        />
      )}
      {voiding && (
        <VoidPaymentModal
          paymentId={voiding.id}
          description={`Pago de ${money(Number(voiding.amount))} de ${voiding.payer_name ?? '—'} a ${voiding.payee_name ?? '—'}`}
          onClose={() => setVoiding(null)}
          onSaved={() => {
            setVoiding(null);
            refetch();
          }}
        />
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">No se pudieron cargar las cuentas: {error}</p>}

      <BalanceTable
        title="Lo que Budi debe pagar"
        empty="Budi no tiene pagos pendientes."
        rows={groups.budiOwes}
        loading={loading}
        counterparty={(b) => ({ name: b.creditor_name, kind: b.creditor_kind, id: b.creditor_id })}
        actionLabel="Registrar pago"
        onAction={setPaying}
      />
      <BalanceTable
        title="Lo que le deben a Budi"
        empty="Nadie le debe a Budi."
        rows={groups.owedToBudi}
        loading={loading}
        counterparty={(b) => ({ name: b.debtor_name, kind: b.debtor_kind, id: b.debtor_id })}
        actionLabel="Registrar cobro"
        onAction={setPaying}
      />
      <BalanceTable
        title="Programas MOPT y sus socios operadores"
        empty="No hay saldos entre programas MOPT y socios operadores."
        rows={groups.moptToOperators}
        loading={loading}
        counterparty={(b) => ({ name: `${b.creditor_name ?? '—'} ← ${b.debtor_name ?? 'MOPT'}`, kind: 'mopt_operator' })}
        actionLabel="Registrar pago"
        onAction={setPaying}
      />

      <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="border-b border-zinc-200 px-4 py-3 font-semibold text-zinc-900 dark:border-zinc-800 dark:text-white">Pagos registrados</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">De → A</th>
                <th className="px-4 py-3 font-medium">Referencia</th>
                <th className="px-4 py-3 font-medium">Registró</th>
                <th className="px-4 py-3 text-right font-medium">Monto</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {payments.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">{loading ? 'Cargando...' : 'Todavía no hay pagos registrados.'}</td></tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} className={p.voided_at ? 'text-zinc-400' : 'text-zinc-700 dark:text-zinc-300'}>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDate(p.paid_on)}</td>
                    <td className="px-4 py-3">
                      {p.payer_name} → {p.payee_name}
                      {p.voided_at && <p className="text-xs text-red-600 dark:text-red-400">Anulado: {p.void_reason}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {p.reference ?? '—'}
                      {p.note && <p className="text-xs text-zinc-500">{p.note}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500">{p.created_by_name ?? '—'}</td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${p.voided_at ? 'line-through' : 'font-medium text-zinc-900 dark:text-white'}`}>
                      {money(Number(p.amount))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!p.voided_at && (
                        <button onClick={() => setVoiding(p)} className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400">
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
      </section>
    </div>
  );
}

function Kpi({
  Icon,
  tint,
  label,
  value,
  sub,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  tint: string;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{value}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tint}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function BalanceTable({
  title,
  empty,
  rows,
  loading,
  counterparty,
  actionLabel,
  onAction,
}: {
  title: string;
  empty: string;
  rows: Balance[];
  loading: boolean;
  counterparty: (b: Balance) => { name: string | null; kind: string; id?: string | null };
  actionLabel: string;
  onAction: (b: Balance) => void;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="border-b border-zinc-200 px-4 py-3 font-semibold text-zinc-900 dark:border-zinc-800 dark:text-white">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">Con quién</th>
              <th className="px-4 py-3 text-right font-medium">Servicios</th>
              <th className="px-4 py-3 text-right font-medium">Generado</th>
              <th className="px-4 py-3 text-right font-medium">Pagado</th>
              <th className="px-4 py-3 text-right font-medium">Pendiente</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500">{loading ? 'Cargando...' : empty}</td></tr>
            ) : (
              rows.map((b) => {
                const cp = counterparty(b);
                // Empresa, aseguradora y MOPT tienen ficha 360 (00105).
                const fichaUrl = ledgerPartyUrl(cp.kind, cp.id ?? null);
                return (
                  <tr key={`${b.debtor_kind}:${b.debtor_id}->${b.creditor_kind}:${b.creditor_id}`}>
                    <td className="px-4 py-3">
                      {fichaUrl ? (
                        <Link href={fichaUrl} className="font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                          {cp.name || '—'}
                        </Link>
                      ) : (
                        <p className="font-medium text-zinc-900 dark:text-white">{cp.name || '—'}</p>
                      )}
                      <p className="text-xs text-zinc-500">{KIND_LABEL[cp.kind] ?? cp.kind}</p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{b.services}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(Number(b.owed))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(Number(b.paid))}
                      {b.last_paid_on && <p className="text-xs text-zinc-500">último {formatDate(b.last_paid_on)}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">{money(Number(b.balance))}</td>
                    <td className="px-4 py-3 text-right">
                      {Number(b.balance) > 0 && (
                        <button onClick={() => onAction(b)} className="whitespace-nowrap rounded-lg bg-budi-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-budi-primary-600">
                          {actionLabel}
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
    </section>
  );
}
