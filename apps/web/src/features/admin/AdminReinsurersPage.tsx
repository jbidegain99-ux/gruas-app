'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Plus } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { formatDateTime } from '@/shared/lib/format';

// REA-01 (00131): reaseguradoras y sus aseguradoras cedentes. El admin crea el
// vínculo y su vigencia; la AUTORIZACIÓN la da cada aseguradora desde su portal.
// El alta de una reaseguradora (y la invitación a su dueño) va por el checklist.

type LinkRow = {
  id: string; insurer_org_id: string; insurer_name: string; valid_from: string; valid_to: string | null;
  consent_status: 'pending' | 'granted' | 'revoked'; consent_at: string | null;
};
type Reinsurer = { id: string; name: string; status: string; members: number; links: LinkRow[] };
type Data = { reinsurers: Reinsurer[]; insurers: { id: string; name: string }[] };

const CONSENT: Record<LinkRow['consent_status'], { label: string; cls: string }> = {
  pending: { label: 'Esperando autorización', cls: 'text-amber-700 dark:text-amber-400' },
  granted: { label: 'Autorizado', cls: 'text-emerald-700 dark:text-emerald-400' },
  revoked: { label: 'Revocado', cls: 'text-zinc-500' },
};
const card = 'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';
const input = 'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

export default function AdminReinsurersPage() {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  // Si la consulta falla, se dice (antes quedaba "Cargando…" para siempre).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState<{ rea: string; insurer: string; from: string; to: string } | null>(null);
  const reload = useCallback(() => setRefresh((k) => k + 1), []);

  useEffect(() => {
    createClient()
      .rpc('admin_reinsurers')
      .then(({ data: d, error }) => {
        if (error) {
          toast.error(error.message);
          setLoadError(error.message);
        } else {
          setLoadError(null);
          setData(d as unknown as Data);
        }
      });
  }, [refresh, toast]);

  const save = async () => {
    if (!form) return;
    const { error } = await createClient().rpc('admin_set_reinsurer_link', {
      p_reinsurer_org: form.rea, p_insurer_org: form.insurer, p_valid_from: form.from, p_valid_to: form.to || null,
    } as never);
    if (error) return toast.error(error.message);
    toast.success('Vínculo guardado. La aseguradora debe autorizarlo desde su portal.');
    setForm(null);
    reload();
  };

  if (!data)
    return loadError ? (
      <p className="text-sm text-red-600 dark:text-red-400">No se pudo cargar: {loadError}</p>
    ) : (
      <p className="text-sm text-zinc-500">Cargando…</p>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Reaseguradoras</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Vincula cada reaseguradora con sus aseguradoras cedentes. Solo verá cifras agregadas de las que lo autoricen
            desde su portal, y nunca celdas con menos de 5 casos.
          </p>
        </div>
        <Link href="/admin/altas" className="inline-flex items-center gap-1.5 rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700">
          <Plus className="h-4 w-4" /> Nueva reaseguradora
        </Link>
      </div>

      {data.reinsurers.length === 0 && (
        <p className={`${card} p-6 text-center text-sm text-zinc-500`}>
          Todavía no hay reaseguradoras. Créala desde Altas de clientes.
        </p>
      )}

      {data.reinsurers.map((r) => (
        <section key={r.id} className={`${card} p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-zinc-900 dark:text-white">{r.name}</h2>
              <p className="text-xs text-zinc-500">{r.members} persona(s) en su portal · {r.status === 'active' ? 'Activa' : 'Suspendida'}</p>
            </div>
            <div className="flex gap-3">
              <Link href={`/admin/altas/${r.id}`} className="inline-flex items-center text-xs font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                Checklist y equipo <ChevronRight className="h-3.5 w-3.5" />
              </Link>
              <button
                onClick={() => setForm({ rea: r.id, insurer: data.insurers[0]?.id ?? '', from: new Date().toISOString().slice(0, 10), to: '' })}
                className="text-xs font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
              >
                Vincular aseguradora
              </button>
            </div>
          </div>

          {form?.rea === r.id && (
            <div className="mt-3 grid gap-2 rounded-lg bg-zinc-50 p-3 sm:grid-cols-4 dark:bg-zinc-950">
              <label className="text-sm sm:col-span-2">
                Aseguradora cedente
                <select className={input} value={form.insurer} onChange={(e) => setForm({ ...form, insurer: e.target.value })}>
                  {data.insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </label>
              <label className="text-sm">Desde<input type="date" className={input} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></label>
              <label className="text-sm">Hasta (opcional)<input type="date" className={input} value={form.to} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} /></label>
              <div className="flex gap-2 sm:col-span-4">
                <button onClick={save} disabled={!form.insurer || !form.from} className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700 disabled:opacity-50">Guardar</button>
                <button onClick={() => setForm(null)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Cancelar</button>
              </div>
            </div>
          )}

          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr><th className="py-2">Aseguradora cedente</th><th className="py-2">Vigencia</th><th className="py-2">Autorización</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {r.links.length === 0 ? (
                <tr><td colSpan={4} className="py-4 text-zinc-500">Sin aseguradoras vinculadas.</td></tr>
              ) : r.links.map((l) => (
                <tr key={l.id}>
                  <td className="py-2">{l.insurer_name}</td>
                  <td className="py-2 text-zinc-600 dark:text-zinc-400">{l.valid_from}{l.valid_to ? ` – ${l.valid_to}` : ' – sin fin'}</td>
                  <td className={`py-2 ${CONSENT[l.consent_status].cls}`}>
                    {CONSENT[l.consent_status].label}{l.consent_at ? ` · ${formatDateTime(l.consent_at)}` : ''}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => setForm({ rea: r.id, insurer: l.insurer_org_id, from: l.valid_from, to: l.valid_to ?? '' })}
                      className="text-xs font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
                    >
                      Cambiar vigencia
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
