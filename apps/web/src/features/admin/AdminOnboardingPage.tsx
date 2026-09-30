'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Plus } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { formatDate } from '@/shared/lib/format';
import { ORG_TYPE_LABEL, type OrgType } from './onboarding';
import { useInsurersEnabled } from '@/shared/lib/use-platform-features';

// Altas de clientes institucionales (migr. 00130, VEN-03): aseguradoras y
// programas MOPT con el avance de su checklist. Un alta nueva empieza aquí.

type Row = {
  organization_id: string; type: OrgType; name: string; started_at: string;
  completed_at: string | null; steps_done: number; steps_total: number;
};

const input = 'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';
const card = 'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';

export default function AdminOnboardingPage() {
  const toast = useToast();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [form, setForm] = useState<{ type: OrgType; name: string; tax: string; contact: string; email: string; phone: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // Aseguradoras en pausa (00153): solo se dan de alta (y se listan) programas MOPT.
  const insurers = useInsurersEnabled();
  const types: OrgType[] = insurers ? ['INSURER', 'MOPT', 'REINSURER'] : ['MOPT'];

  useEffect(() => {
    createClient()
      .rpc('admin_onboarding_overview')
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        else setRows((data as Row[]) ?? []);
      });
  }, [toast]);

  const create = async () => {
    if (!form) return;
    setSaving(true);
    const { data, error } = await createClient().rpc('admin_create_institution', {
      p_type: form.type, p_name: form.name, p_tax_id: form.tax, p_contact_name: form.contact,
      p_contact_email: form.email, p_contact_phone: form.phone,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    router.push(`/admin/altas/${data as string}`);
  };

  // Primero lo pendiente (menos avanzado arriba), luego lo terminado.
  const sorted = [...(rows ?? [])].filter((r) => insurers || r.type === 'MOPT').sort(
    (a, b) => Number(!!a.completed_at) - Number(!!b.completed_at) || a.steps_done - b.steps_done || a.name.localeCompare(b.name),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Altas de clientes</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            {insurers ? 'Aseguradoras, programas MOPT y reaseguradoras' : 'Programas MOPT'}, con los pasos que les faltan para operar. La meta es dejar un cliente
            listo en menos de un día.
          </p>
        </div>
        {!form && (
          <button
            onClick={() => setForm({ type: types[0], name: '', tax: '', contact: '', email: '', phone: '' })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700"
          >
            <Plus className="h-4 w-4" /> Nuevo cliente
          </button>
        )}
      </div>

      {form && (
        <div className={`${card} grid gap-3 p-4 sm:grid-cols-2`}>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm">Tipo de cliente</legend>
            <div className="mt-1 flex gap-4">
              {types.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="tipo" checked={form.type === t} onChange={() => setForm({ ...form, type: t })} />
                  {ORG_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-sm">Nombre<input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          {form.type === 'INSURER' && (
            <label className="text-sm">NIT (opcional)<input className={input} value={form.tax} onChange={(e) => setForm({ ...form, tax: e.target.value })} /></label>
          )}
          {form.type === 'INSURER' && (
            <label className="text-sm">Persona de contacto<input className={input} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></label>
          )}
          {form.type !== 'REINSURER' && (
            <label className="text-sm">Correo de contacto<input type="email" className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          )}
          {form.type !== 'REINSURER' && (
            <label className="text-sm">Teléfono<input className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button onClick={create} disabled={saving || !form.name.trim()} className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700 disabled:opacity-50">
              {saving ? 'Creando…' : 'Crear y abrir checklist'}
            </button>
            <button onClick={() => setForm(null)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Cancelar</button>
          </div>
        </div>
      )}

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Inicio</th>
              <th className="px-4 py-3">Avance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows === null ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-500">Cargando…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-500">Todavía no hay clientes institucionales.</td></tr>
            ) : sorted.map((r) => (
              <tr key={r.organization_id}>
                <td className="px-4 py-3">
                  <Link href={`/admin/altas/${r.organization_id}`} className="font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{ORG_TYPE_LABEL[r.type]}</td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{formatDate(r.started_at)}</td>
                <td className="px-4 py-3">
                  {r.completed_at ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" /> Alta completa
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
                        <span className="block h-full rounded-full bg-budi-primary-500" style={{ width: `${(100 * r.steps_done) / r.steps_total}%` }} />
                      </span>
                      <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{r.steps_done} de {r.steps_total}</span>
                    </span>
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
