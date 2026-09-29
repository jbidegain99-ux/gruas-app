'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { ContractCard } from './ContractCard';
import { ON_CAP_LABEL, type ContractStatus } from './contract-types';

// Edición del contrato desde el admin (migr. 00124). Queda en la bitácora.
export function ContractEditor({ organizationId }: { organizationId: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [f, setF] = useState({ reference: '', from: '', to: '', cap: '', onCap: 'keep_courtesy', notes: '' });
  // El tope mensual solo mueve algo en MOPT (corta o factura la cortesía); a una
  // aseguradora (VEN-03) se le registra el contrato sin esos campos.
  const [isMopt, setIsMopt] = useState(true);

  useEffect(() => {
    if (!open) return;
    createClient()
      .rpc('org_contract_status', { p_org: organizationId })
      .then(({ data }) => {
        const s = data as unknown as ContractStatus | null;
        if (s?.organization) setIsMopt(s.organization.type === 'MOPT');
        if (s?.has_contract)
          setF({
            reference: s.reference ?? '',
            from: s.valid_from ?? '',
            to: s.valid_to ?? '',
            cap: s.monthly_cap == null ? '' : String(s.monthly_cap),
            onCap: s.on_cap ?? 'keep_courtesy',
            notes: s.tariff_notes ?? '',
          });
      });
  }, [open, organizationId]);

  const save = async () => {
    const { error } = await createClient().rpc('admin_set_org_contract', {
      p_org: organizationId,
      p_reference: f.reference,
      p_valid_from: f.from,
      p_valid_to: f.to || null,
      p_monthly_cap: f.cap ? Number(f.cap) : null,
      p_on_cap: f.onCap,
      p_tariff_notes: f.notes,
    } as never);
    if (error) return toast.error(error.message);
    toast.success('Contrato guardado.');
    setOpen(false);
    setRefresh((k) => k + 1);
  };

  const input = 'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

  return (
    <div className="space-y-3">
      <ContractCard organizationId={organizationId} refreshKey={refresh} />
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-sm font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
          Editar contrato
        </button>
      ) : (
        <div className="grid gap-3 rounded-xl border border-zinc-200 p-4 sm:grid-cols-2 dark:border-zinc-800">
          <label className="text-sm text-zinc-700 dark:text-zinc-300">
            Referencia
            <input className={input} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder={isMopt ? 'Ej. MOPT-2026-014' : 'Ej. ASE-2026-003'} />
          </label>
          {isMopt && (
            <label className="text-sm text-zinc-700 dark:text-zinc-300">
              Tope mensual (USD, vacío = sin tope)
              <input className={input} inputMode="decimal" value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value })} />
            </label>
          )}
          <label className="text-sm text-zinc-700 dark:text-zinc-300">
            Vigente desde
            <input type="date" className={input} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          </label>
          <label className="text-sm text-zinc-700 dark:text-zinc-300">
            Hasta (vacío = sin fin)
            <input type="date" className={input} value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </label>
          {isMopt && (
          <label className="text-sm text-zinc-700 sm:col-span-2 dark:text-zinc-300">
            Al llegar al tope
            <select className={input} value={f.onCap} onChange={(e) => setF({ ...f, onCap: e.target.value })}>
              {(Object.keys(ON_CAP_LABEL) as (keyof typeof ON_CAP_LABEL)[]).map((k) => (
                <option key={k} value={k}>{ON_CAP_LABEL[k]}</option>
              ))}
            </select>
          </label>
          )}
          <label className="text-sm text-zinc-700 sm:col-span-2 dark:text-zinc-300">
            Tarifas pactadas (texto que ve el cliente)
            <textarea className={input} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button onClick={save} disabled={!f.from} className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700 disabled:opacity-50">
              Guardar
            </button>
            <button onClick={() => setOpen(false)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
