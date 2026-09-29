'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, ShieldCheck } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { serviceTypeLabel } from '@/shared/components/ServiceTypeBadge';
import { formatDate } from '@/shared/lib/format';

// Pólizas y planes de la aseguradora (migr. 00127, ASE-02). Crear y editar:
// dueño y administradores del portal. Las reglas de cobertura de cada plan
// (qué servicios, cuántos y hasta qué monto) las configura Budi.

type Plan = { id: string; code: string; name: string; description: string | null; is_active: boolean; services: string[] };
type Policy = {
  id: string; policy_number: string; holder_name: string; plan_id: string; plan_name: string;
  starts_on: string; ends_on: string | null; status: 'active' | 'suspended' | 'expired' | 'cancelled';
  members_active: number; members_total: number;
};
type Catalog = { role: 'owner' | 'admin' | 'analyst' | 'viewer'; plans: Plan[]; policies: Policy[] };

const STATUS: Record<Policy['status'], string> = { active: 'Vigente', suspended: 'Suspendida', expired: 'Vencida', cancelled: 'Cancelada' };
const input = 'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';
const card = 'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';

export default function InsurerPoliciesPage() {
  const toast = useToast();
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState<Partial<Plan> | null>(null);
  const [editPolicy, setEditPolicy] = useState<Partial<Policy> | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((k) => k + 1), []);

  useEffect(() => {
    createClient()
      .rpc('portal_insurer_catalog')
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setCat(data as unknown as Catalog);
      });
  }, [refresh]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!cat) return <p className="text-sm text-zinc-500">Cargando…</p>;
  const manage = cat.role === 'owner' || cat.role === 'admin';

  const savePlan = async () => {
    const p = editPlan!;
    const { error: e } = await createClient().rpc('portal_save_plan', {
      p_id: p.id ?? null, p_code: p.code ?? '', p_name: p.name ?? '', p_description: p.description ?? '', p_is_active: p.is_active ?? true,
    } as never);
    if (e) return toast.error(e.message);
    toast.success('Plan guardado.');
    setEditPlan(null);
    reload();
  };

  const savePolicy = async () => {
    const p = editPolicy!;
    const { error: e } = await createClient().rpc('portal_save_policy', {
      p_id: p.id ?? null, p_policy_number: p.policy_number ?? '', p_holder_name: p.holder_name ?? '', p_plan: p.plan_id ?? null,
      p_starts_on: p.starts_on ?? null, p_ends_on: p.ends_on || null, p_status: p.status ?? 'active',
    } as never);
    if (e) return toast.error(e.message);
    toast.success('Póliza guardada.');
    setEditPolicy(null);
    reload();
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Pólizas y afiliados</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Tus planes, pólizas y el padrón de afiliados. Una baja corta la cobertura al instante.
          {!manage && ' Tu rol permite consultar' + (cat.role === 'analyst' ? ' y administrar afiliados.' : '.')}
        </p>
      </div>

      {/* Pólizas */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-zinc-900 dark:text-white">Pólizas</h2>
          {manage && cat.plans.length > 0 && (
            <button onClick={() => setEditPolicy({ status: 'active', plan_id: cat.plans[0].id })} className="inline-flex items-center gap-1 text-sm font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
              <Plus className="h-4 w-4" /> Nueva póliza
            </button>
          )}
        </div>
        {editPolicy && (
          <div className={`${card} mb-3 grid gap-3 p-4 sm:grid-cols-2`}>
            <label className="text-sm">Número de póliza<input className={input} value={editPolicy.policy_number ?? ''} onChange={(e) => setEditPolicy({ ...editPolicy, policy_number: e.target.value })} /></label>
            <label className="text-sm">Contratante<input className={input} value={editPolicy.holder_name ?? ''} onChange={(e) => setEditPolicy({ ...editPolicy, holder_name: e.target.value })} /></label>
            <label className="text-sm">Plan
              <select className={input} value={editPolicy.plan_id ?? ''} onChange={(e) => setEditPolicy({ ...editPolicy, plan_id: e.target.value })}>
                {cat.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-sm">Estado
              <select className={input} value={editPolicy.status ?? 'active'} onChange={(e) => setEditPolicy({ ...editPolicy, status: e.target.value as Policy['status'] })}>
                {(Object.keys(STATUS) as Policy['status'][]).map((k) => <option key={k} value={k}>{STATUS[k]}</option>)}
              </select>
            </label>
            <label className="text-sm">Vigente desde<input type="date" className={input} value={editPolicy.starts_on ?? ''} onChange={(e) => setEditPolicy({ ...editPolicy, starts_on: e.target.value })} /></label>
            <label className="text-sm">Hasta (opcional)<input type="date" className={input} value={editPolicy.ends_on ?? ''} onChange={(e) => setEditPolicy({ ...editPolicy, ends_on: e.target.value })} /></label>
            <div className="flex gap-2 sm:col-span-2">
              <button onClick={savePolicy} className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700">Guardar</button>
              <button onClick={() => setEditPolicy(null)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Cancelar</button>
            </div>
          </div>
        )}
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Póliza</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Vigencia</th>
                <th className="px-4 py-3">Estado</th><th className="px-4 py-3 text-right">Afiliados activos</th><th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {cat.policies.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">{manage ? 'Crea tu primer plan y luego la póliza.' : 'Todavía no hay pólizas.'}</td></tr>
              ) : cat.policies.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <Link href={`/portal/polizas/${p.id}`} className="font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">{p.policy_number}</Link>
                    <p className="text-xs text-zinc-500">{p.holder_name}</p>
                  </td>
                  <td className="px-4 py-3">{p.plan_name}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{formatDate(p.starts_on)} – {p.ends_on ? formatDate(p.ends_on) : 'sin fin'}</td>
                  <td className="px-4 py-3">{STATUS[p.status]}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.members_active.toLocaleString('es-SV')} <span className="text-zinc-400">/ {p.members_total.toLocaleString('es-SV')}</span></td>
                  <td className="px-4 py-3 text-right">
                    {manage && <button onClick={() => setEditPolicy(p)} className="text-xs text-budi-primary-600 hover:underline dark:text-budi-primary-400">Editar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Planes */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-zinc-900 dark:text-white">Planes</h2>
          {manage && (
            <button onClick={() => setEditPlan({ is_active: true })} className="inline-flex items-center gap-1 text-sm font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
              <Plus className="h-4 w-4" /> Nuevo plan
            </button>
          )}
        </div>
        {editPlan && (
          <div className={`${card} mb-3 grid gap-3 p-4 sm:grid-cols-2`}>
            <label className="text-sm">Código<input className={input} value={editPlan.code ?? ''} onChange={(e) => setEditPlan({ ...editPlan, code: e.target.value })} /></label>
            <label className="text-sm">Nombre<input className={input} value={editPlan.name ?? ''} onChange={(e) => setEditPlan({ ...editPlan, name: e.target.value })} /></label>
            <label className="text-sm sm:col-span-2">Descripción<input className={input} value={editPlan.description ?? ''} onChange={(e) => setEditPlan({ ...editPlan, description: e.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editPlan.is_active ?? true} onChange={(e) => setEditPlan({ ...editPlan, is_active: e.target.checked })} /> Activo</label>
            <div className="flex gap-2 sm:col-span-2">
              <button onClick={savePlan} className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700">Guardar</button>
              <button onClick={() => setEditPlan(null)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Cancelar</button>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {cat.plans.map((p) => (
            <div key={p.id} className={`${card} p-4`}>
              <div className="flex items-start justify-between">
                <p className="font-medium text-zinc-900 dark:text-white">{p.name} <span className="text-xs font-normal text-zinc-500">· {p.code}</span></p>
                {manage && <button onClick={() => setEditPlan(p)} className="text-xs text-budi-primary-600 hover:underline dark:text-budi-primary-400">Editar</button>}
              </div>
              {p.description && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{p.description}</p>}
              <p className="mt-2 flex items-start gap-1.5 text-xs text-zinc-500">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {p.services.length ? `Cubre: ${p.services.map(serviceTypeLabel).join(', ')}` : 'Sin reglas de cobertura todavía: las configura Budi contigo.'}
                {!p.is_active && ' · Inactivo'}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
