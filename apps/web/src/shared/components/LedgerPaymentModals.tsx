'use client';

import { useState } from 'react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { money } from '@/shared/lib/format';

// Registrar y anular pagos del libro de movimientos (migr. 00099). Los usan el
// admin (/admin/cuentas) y el portal MOPT (/mopt/operadores): la validación de
// fondo —quién puede pagarle a quién, y que no se pague de más— vive en la base.

export type LedgerParty = { kind: string; id: string | null; name: string };

const inputClass =
  'mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

/** Fecha de hoy en El Salvador, 'YYYY-MM-DD'. */
export function svToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(new Date());
}

function ModalFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function RegisterPaymentModal({
  payer,
  payee,
  balance,
  onClose,
  onSaved,
  warning,
}: {
  payer: LedgerParty;
  payee: LedgerParty;
  /** Saldo pendiente del par: el tope del monto. */
  balance: number;
  /** Aviso antes de pagar (p. ej. casos observados sin resolver); no bloquea. */
  warning?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(balance.toFixed(2));
  const [paidOn, setPaidOn] = useState(svToday());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc('register_ledger_payment', {
      p_payer_kind: payer.kind,
      // Budi no tiene id: la RPC espera NULL ahí (el tipo generado no lo sabe,
      // porque el parámetro no tiene DEFAULT).
      p_payer_id: payer.id as string,
      p_payee_kind: payee.kind,
      p_payee_id: payee.id as string,
      p_amount: Number(amount),
      p_paid_on: paidOn,
      p_reference: reference,
      p_note: note,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    toast.success(`Pago de ${money(Number(amount))} registrado.`);
    onSaved();
  };

  return (
    <ModalFrame title="Registrar pago">
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        <span className="font-medium text-zinc-900 dark:text-white">{payer.name}</span> le pagó a{' '}
        <span className="font-medium text-zinc-900 dark:text-white">{payee.name}</span>. Saldo pendiente:{' '}
        <span className="font-semibold tabular-nums text-zinc-900 dark:text-white">{money(balance)}</span>
      </p>
      {warning && (
        <div role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">{warning}</div>
      )}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">{error}</div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Monto (USD)
            <input id="pay-amount" type="number" min="0.01" max={balance} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Fecha del pago
            <input id="pay-date" type="date" required max={svToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Referencia
          <input id="pay-ref" type="text" placeholder="N.º de transferencia o cheque" value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Nota
          <input id="pay-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50">
            {saving ? 'Guardando...' : 'Registrar pago'}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

export function VoidPaymentModal({
  description,
  paymentId,
  onClose,
  onSaved,
}: {
  description: string;
  paymentId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc('void_ledger_payment', {
      p_payment_id: paymentId,
      p_reason: reason,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    toast.success('Pago anulado. El saldo volvió a quedar pendiente.');
    onSaved();
  };

  return (
    <ModalFrame title="Anular pago">
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        {description}. El pago no se borra: queda anulado, con el motivo, y el monto vuelve al saldo pendiente.
      </p>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">{error}</div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Motivo
          <input id="void-reason" type="text" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: monto mal cargado" className={inputClass} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
            {saving ? 'Anulando...' : 'Anular pago'}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
