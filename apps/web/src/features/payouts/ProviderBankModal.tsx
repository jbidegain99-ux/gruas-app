'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';

// Cuenta bancaria de una empresa de grúas (migr. 00125): a dónde le paga Budi.
// Cada cambio queda en la Bitácora.
type Bank = { bank_name: string; account_type: 'ahorro' | 'corriente'; account_number: string; holder: string; holder_nit: string | null };

export function ProviderBankModal({ providerId, providerName, onClose }: { providerId: string; providerName: string; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Bank>({ bank_name: '', account_type: 'corriente', account_number: '', holder: providerName, holder_nit: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    createClient()
      .rpc('admin_provider_bank', { p_provider: providerId })
      .then(({ data }) => {
        if (data) setF({ ...(data as unknown as Bank), holder_nit: (data as unknown as Bank).holder_nit ?? '' });
      });
  }, [providerId]);

  const save = async () => {
    setSaving(true);
    const { error } = await createClient().rpc('admin_set_provider_bank', {
      p_provider: providerId, p_bank: f.bank_name, p_type: f.account_type, p_number: f.account_number,
      p_holder: f.holder, p_nit: f.holder_nit ?? '',
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Cuenta bancaria guardada.');
    onClose();
  };

  const input = 'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Cuenta bancaria">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-heading text-lg font-semibold text-zinc-900 dark:text-white">Cuenta bancaria</h2>
            <p className="text-sm text-zinc-500">{providerName} · a dónde le paga Budi</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3">
          <label className="block text-sm text-zinc-700 dark:text-zinc-300">
            Banco
            <input className={input} value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} placeholder="Ej. Banco Agrícola" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-zinc-700 dark:text-zinc-300">
              Tipo
              <select className={input} value={f.account_type} onChange={(e) => setF({ ...f, account_type: e.target.value as Bank['account_type'] })}>
                <option value="corriente">Corriente</option>
                <option value="ahorro">Ahorro</option>
              </select>
            </label>
            <label className="block text-sm text-zinc-700 dark:text-zinc-300">
              Número de cuenta
              <input className={input} inputMode="numeric" value={f.account_number} onChange={(e) => setF({ ...f, account_number: e.target.value })} />
            </label>
          </div>
          <label className="block text-sm text-zinc-700 dark:text-zinc-300">
            Titular
            <input className={input} value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} />
          </label>
          <label className="block text-sm text-zinc-700 dark:text-zinc-300">
            NIT del titular (opcional)
            <input className={input} value={f.holder_nit ?? ''} onChange={(e) => setF({ ...f, holder_nit: e.target.value })} placeholder="0614-010190-101-1" />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Cancelar</button>
          <button
            onClick={save}
            disabled={saving || !f.bank_name.trim() || !f.account_number.trim() || !f.holder.trim()}
            className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700 disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
