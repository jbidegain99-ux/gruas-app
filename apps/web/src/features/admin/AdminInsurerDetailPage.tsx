'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast, useConfirm } from '@/shared/components/FeedbackProvider';
import { formatDate } from '@/shared/lib/format';
import { Campo } from './AdminInsurersPage';
import { InsurerApiKeys } from './InsurerApiKeys';
import {
  RULE_KEYS,
  SERVICE_TYPES,
  describeRule,
  ruleWarnings,
  serviceTypeLabel,
  sortRules,
  type CoverageRule,
  type RuleKey,
} from './coverage-rules';

// Detalle de una aseguradora (B-09): sus planes de cobertura con las reglas de
// cada uno, y sus pólizas. Los afiliados cuelgan de la póliza, en /admin/policies/[id].

type Insurer = {
  id: string;
  name: string;
  tax_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  // B-15: objetivos de SLA que la aseguradora pacta.
  sla_assignment_minutes: number;
  sla_arrival_minutes: number;
};

type Plan = {
  id: string;
  insurer_id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

type Policy = {
  id: string;
  policy_number: string;
  holder_name: string;
  starts_on: string;
  ends_on: string | null;
  status: string;
  plan_id: string;
  coverage_plans: { code: string; name: string } | null;
  members: { count: number }[];
};

const ESTADOS: Record<string, { label: string; clase: string }> = {
  active: { label: 'Activa', clase: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  suspended: { label: 'Suspendida', clase: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  expired: { label: 'Vencida', clase: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  cancelled: { label: 'Cancelada', clase: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

export default function AdminInsurerDetailPage({ insurerId }: { insurerId: string }) {
  const [insurer, setInsurer] = useState<Insurer | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [rules, setRules] = useState<CoverageRule[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [planForm, setPlanForm] = useState<{ open: boolean; plan: Plan | null }>({ open: false, plan: null });
  const [policyForm, setPolicyForm] = useState<{ open: boolean; policy: Policy | null }>({ open: false, policy: null });
  const toast = useToast();
  const confirm = useConfirm();

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const [ins, pl, po] = await Promise.all([
        supabase.from('insurers').select('*').eq('id', insurerId).single(),
        supabase.from('coverage_plans').select('*').eq('insurer_id', insurerId).order('code'),
        supabase
          .from('policies')
          .select('*, coverage_plans(code, name), members(count)')
          .eq('insurer_id', insurerId)
          .order('policy_number'),
      ]);

      setInsurer((ins.data as Insurer) || null);
      const planes = (pl.data as Plan[]) || [];
      setPlans(planes);
      setPolicies((po.data as unknown as Policy[]) || []);

      // Las reglas se traen en una sola consulta para todos los planes; separarlas
      // por plan en memoria evita N consultas al desplegar cada tarjeta.
      if (planes.length) {
        const { data } = await supabase
          .from('coverage_rules')
          .select('*')
          .in('plan_id', planes.map((p) => p.id));
        setRules((data as CoverageRule[]) || []);
      } else {
        setRules([]);
      }
      setLoading(false);
    };
    load();
  }, [insurerId, refreshKey]);

  const handleDeletePlan = async (plan: Plan) => {
    const usado = policies.some((p) => p.plan_id === plan.id);
    if (usado) {
      return toast.error('No se puede eliminar: hay pólizas usando este plan.');
    }
    const ok = await confirm({
      title: `¿Eliminar el plan ${plan.name}?`,
      message: 'Se eliminarán también sus reglas de cobertura.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase.from('coverage_plans').delete().eq('id', plan.id);
    if (error) return toast.error('No se pudo eliminar el plan.');
    toast.success('Plan eliminado.');
    refetch();
  };

  const handleDeletePolicy = async (policy: Policy) => {
    const afiliados = policy.members?.[0]?.count ?? 0;
    const ok = await confirm({
      title: `¿Eliminar la póliza ${policy.policy_number}?`,
      message: afiliados
        ? `Se eliminarán también sus ${afiliados} afiliado${afiliados === 1 ? '' : 's'}.`
        : 'Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase.from('policies').delete().eq('id', policy.id);
    if (error) return toast.error('No se pudo eliminar la póliza.');
    toast.success('Póliza eliminada.');
    refetch();
  };

  if (loading) return <p className="p-8 text-center text-sm text-zinc-500">Cargando…</p>;
  if (!insurer) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-zinc-500">No se encontró la aseguradora.</p>
        <Link href="/admin/insurers" className="mt-2 inline-block text-sm text-budi-primary-600 hover:underline">
          Volver al listado
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/admin/insurers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Aseguradoras
      </Link>

      <div className="mb-8">
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">{insurer.name}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {[insurer.tax_id && `NIT ${insurer.tax_id}`, insurer.contact_name, insurer.contact_email, insurer.contact_phone]
            .filter(Boolean)
            .join(' · ') || 'Sin datos de contacto'}
        </p>
      </div>

      {/* ── Objetivos de SLA (B-15) ─────────────────────────────────────── */}
      <SlaTargets insurer={insurer} onSaved={() => setRefreshKey((k) => k + 1)} />

      {/* ── Planes de cobertura ─────────────────────────────────────────── */}
      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">Planes de cobertura</h2>
          <button
            onClick={() => setPlanForm({ open: true, plan: null })}
            className="flex items-center gap-2 rounded-lg bg-budi-primary-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-budi-primary-600"
          >
            <Plus className="h-4 w-4" />
            Nuevo plan
          </button>
        </div>

        {plans.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Sin planes todavía. Un plan define qué cubre la póliza y con qué topes.
          </p>
        ) : (
          <div className="space-y-4">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                rules={rules.filter((r) => r.plan_id === plan.id)}
                onEdit={() => setPlanForm({ open: true, plan })}
                onDelete={() => handleDeletePlan(plan)}
                onRulesChanged={refetch}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Pólizas ─────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">Pólizas</h2>
          <button
            onClick={() => setPolicyForm({ open: true, policy: null })}
            disabled={plans.length === 0}
            title={plans.length === 0 ? 'Creá primero un plan de cobertura' : undefined}
            className="flex items-center gap-2 rounded-lg bg-budi-primary-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Nueva póliza
          </button>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {policies.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-500">
              {plans.length === 0
                ? 'Creá primero un plan de cobertura para poder emitir pólizas.'
                : 'Sin pólizas todavía.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <tr>
                    <th className="px-6 py-3">Número</th>
                    <th className="px-6 py-3">Titular</th>
                    <th className="px-6 py-3">Plan</th>
                    <th className="px-6 py-3">Vigencia</th>
                    <th className="px-6 py-3">Afiliados</th>
                    <th className="px-6 py-3">Estado</th>
                    <th className="px-6 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {policies.map((p) => {
                    const est = ESTADOS[p.status] ?? ESTADOS.expired;
                    return (
                      <tr key={p.id} className="transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <td className="px-6 py-4">
                          <Link
                            href={`/admin/policies/${p.id}`}
                            className="flex items-center gap-1 font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
                          >
                            {p.policy_number}
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </td>
                        <td className="px-6 py-4 text-zinc-900 dark:text-white">{p.holder_name}</td>
                        <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400">
                          {p.coverage_plans?.name ?? '—'}
                        </td>
                        <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400">
                          {formatDate(p.starts_on)} — {p.ends_on ? formatDate(p.ends_on) : 'sin fin'}
                        </td>
                        <td className="px-6 py-4 text-zinc-900 dark:text-white">{p.members?.[0]?.count ?? 0}</td>
                        <td className="px-6 py-4">
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${est.clase}`}>{est.label}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex justify-end gap-3 text-xs font-medium">
                            <button
                              onClick={() => setPolicyForm({ open: true, policy: p })}
                              className="text-budi-primary-600 hover:underline dark:text-budi-primary-400"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => handleDeletePolicy(p)}
                              className="text-red-600 hover:underline dark:text-red-400"
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <InsurerApiKeys insurerId={insurerId} />

      {planForm.open && (
        <PlanForm
          insurerId={insurerId}
          plan={planForm.plan}
          onClose={() => setPlanForm({ open: false, plan: null })}
          onSaved={() => {
            setPlanForm({ open: false, plan: null });
            refetch();
          }}
        />
      )}

      {policyForm.open && (
        <PolicyForm
          insurerId={insurerId}
          plans={plans}
          policy={policyForm.policy}
          onClose={() => setPolicyForm({ open: false, policy: null })}
          onSaved={() => {
            setPolicyForm({ open: false, policy: null });
            refetch();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tarjeta de un plan con su editor de reglas
// ─────────────────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  rules,
  onEdit,
  onDelete,
  onRulesChanged,
}: {
  plan: Plan;
  rules: CoverageRule[];
  onEdit: () => void;
  onDelete: () => void;
  onRulesChanged: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const avisos = ruleWarnings(rules);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4 p-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {plan.code}
            </span>
            <h3 className="font-medium text-zinc-900 dark:text-white">{plan.name}</h3>
            {!plan.is_active && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                Inactivo
              </span>
            )}
          </div>
          {plan.description && (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{plan.description}</p>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            {rules.length} regla{rules.length === 1 ? '' : 's'} de cobertura
          </p>
        </div>
        <div className="flex shrink-0 gap-3 text-xs font-medium">
          <button onClick={() => setAbierto((v) => !v)} className="text-zinc-600 hover:underline dark:text-zinc-400">
            {abierto ? 'Ocultar reglas' : 'Ver reglas'}
          </button>
          <button onClick={onEdit} className="text-budi-primary-600 hover:underline dark:text-budi-primary-400">
            Editar
          </button>
          <button onClick={onDelete} className="text-red-600 hover:underline dark:text-red-400">
            Eliminar
          </button>
        </div>
      </div>

      {avisos.length > 0 && (
        <div className="mx-5 mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
          {avisos.map((a, i) => (
            <p key={i} className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {a}
            </p>
          ))}
        </div>
      )}

      {abierto && <RulesEditor planId={plan.id} rules={rules} onChanged={onRulesChanged} />}
    </div>
  );
}

function RulesEditor({
  planId,
  rules,
  onChanged,
}: {
  planId: string;
  rules: CoverageRule[];
  onChanged: () => void;
}) {
  const [serviceType, setServiceType] = useState<string>('');
  const [ruleKey, setRuleKey] = useState<RuleKey>('covered');
  const [valor, setValor] = useState('1');
  const [guardando, setGuardando] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const meta = RULE_KEYS.find((r) => r.key === ruleKey);

  const agregar = async () => {
    setGuardando(true);
    const supabase = createClient();
    const tipo = serviceType || null;

    // No se puede usar `upsert({ onConflict })` aquí: la unicidad la garantiza un
    // índice con expresión —`COALESCE(service_type,'*')`, porque dos NULL no son
    // iguales en SQL— y PostgREST solo acepta como destino de conflicto una
    // constraint sobre columnas planas. Devolvía 400. Se resuelve buscando la
    // regla existente y decidiendo entre UPDATE e INSERT.
    const existente = rules.find((r) => r.service_type === tipo && r.rule_key === ruleKey);

    const { error } = existente
      ? await supabase
          .from('coverage_rules')
          .update({ rule_value: Number(valor) })
          .eq('id', existente.id)
      : await supabase.from('coverage_rules').insert({
          plan_id: planId,
          service_type: tipo,
          rule_key: ruleKey,
          rule_value: Number(valor),
        });

    setGuardando(false);
    if (error) return toast.error('No se pudo guardar la regla.');
    toast.success(existente ? 'Regla actualizada.' : 'Regla agregada.');
    onChanged();
  };

  const eliminar = async (rule: CoverageRule) => {
    const ok = await confirm({
      title: '¿Eliminar esta regla?',
      message: describeRule(rule),
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase.from('coverage_rules').delete().eq('id', rule.id);
    if (error) return toast.error('No se pudo eliminar la regla.');
    toast.success('Regla eliminada.');
    onChanged();
  };

  return (
    <div className="border-t border-zinc-200 p-5 dark:border-zinc-800">
      {rules.length === 0 ? (
        <p className="mb-4 text-sm text-zinc-500">
          Sin reglas. Empezá por una regla general de «Cubierto» y luego afiná por tipo de servicio.
        </p>
      ) : (
        <ul className="mb-4 space-y-2">
          {sortRules(rules).map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-4 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50"
            >
              <span className="text-sm text-zinc-700 dark:text-zinc-300">{describeRule(r)}</span>
              <button
                onClick={() => eliminar(r)}
                aria-label={`Eliminar regla: ${describeRule(r)}`}
                className="shrink-0 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <div>
          <label className="block text-xs font-medium text-zinc-500">Aplica a</label>
          <select
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            className="mt-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          >
            <option value="">Todos los servicios</option>
            {SERVICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {serviceTypeLabel(t)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-500">Regla</label>
          <select
            value={ruleKey}
            onChange={(e) => {
              const k = e.target.value as RuleKey;
              setRuleKey(k);
              setValor(k === 'covered' ? '1' : '');
            }}
            className="mt-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          >
            {RULE_KEYS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-500">Valor</label>
          {meta?.boolean ? (
            <select
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              <option value="1">Sí, incluido</option>
              <option value="0">No cubierto</option>
            </select>
          ) : (
            <input
              type="number"
              min="0"
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={meta?.unit}
              className="mt-1 w-32 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          )}
        </div>

        <button
          onClick={agregar}
          disabled={guardando || valor === ''}
          className="rounded-lg bg-budi-primary-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
        >
          {guardando ? 'Guardando…' : 'Agregar regla'}
        </button>

        {meta && <p className="w-full text-xs text-zinc-500">{meta.hint}</p>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Formularios
// ─────────────────────────────────────────────────────────────────────────────

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        {children}
      </div>
    </div>
  );
}

function PlanForm({
  insurerId,
  plan,
  onClose,
  onSaved,
}: {
  insurerId: string;
  plan: Plan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(plan?.code || '');
  const [name, setName] = useState(plan?.name || '');
  const [description, setDescription] = useState(plan?.description || '');
  const [isActive, setIsActive] = useState(plan?.is_active ?? true);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const payload = {
      insurer_id: insurerId,
      code: code.trim().toUpperCase(),
      name: name.trim(),
      description: description.trim() || null,
      is_active: isActive,
    };
    const { error } = plan
      ? await supabase.from('coverage_plans').update(payload).eq('id', plan.id)
      : await supabase.from('coverage_plans').insert(payload);
    setLoading(false);
    if (error) {
      // El UNIQUE (insurer_id, code) es la causa más probable.
      return toast.error(
        error.code === '23505' ? 'Ya existe un plan con ese código.' : 'No se pudo guardar el plan.'
      );
    }
    toast.success(plan ? 'Plan actualizado.' : 'Plan creado.');
    onSaved();
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">
          {plan ? 'Editar plan' : 'Nuevo plan de cobertura'}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Código" required value={code} onChange={setCode} placeholder="ORO" />
          <Campo label="Nombre" required value={name} onChange={setName} placeholder="Plan Oro" />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Descripción</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Qué incluye este plan, en lenguaje de venta."
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded border-zinc-300 text-budi-primary-500 focus:ring-budi-primary-500"
          />
          Plan activo
        </label>
        <p className="text-xs text-zinc-500">
          Las reglas de cobertura se configuran después, desde «Ver reglas» en la tarjeta del plan.
        </p>
        <Acciones loading={loading} onClose={onClose} disabled={!code.trim() || !name.trim()} />
      </form>
    </Modal>
  );
}

function PolicyForm({
  insurerId,
  plans,
  policy,
  onClose,
  onSaved,
}: {
  insurerId: string;
  plans: Plan[];
  policy: Policy | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [number, setNumber] = useState(policy?.policy_number || '');
  const [holder, setHolder] = useState(policy?.holder_name || '');
  const [planId, setPlanId] = useState(policy?.plan_id || plans[0]?.id || '');
  const [startsOn, setStartsOn] = useState(policy?.starts_on || new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState(policy?.ends_on || '');
  const [status, setStatus] = useState(policy?.status || 'active');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const fechasInvalidas = !!endsOn && endsOn < startsOn;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const payload = {
      insurer_id: insurerId,
      plan_id: planId,
      policy_number: number.trim(),
      holder_name: holder.trim(),
      starts_on: startsOn,
      ends_on: endsOn || null,
      status,
    };
    const { error } = policy
      ? await supabase.from('policies').update(payload).eq('id', policy.id)
      : await supabase.from('policies').insert(payload);
    setLoading(false);
    if (error) {
      return toast.error(
        error.code === '23505' ? 'Ya existe una póliza con ese número.' : 'No se pudo guardar la póliza.'
      );
    }
    toast.success(policy ? 'Póliza actualizada.' : 'Póliza creada.');
    onSaved();
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">
          {policy ? 'Editar póliza' : 'Nueva póliza'}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Número" required value={number} onChange={setNumber} placeholder="POL-2026-0001" />
          <Campo label="Titular" required value={holder} onChange={setHolder} placeholder="Nombre del titular" />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Plan <span className="text-red-500">*</span>
          </label>
          <select
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            required
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Inicio <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={startsOn}
              required
              onChange={(e) => setStartsOn(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Fin</label>
            <input
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
            <p className="mt-1 text-xs text-zinc-500">Vacío = sin fecha de fin pactada.</p>
          </div>
        </div>

        {fechasInvalidas && (
          <p className="text-xs text-red-600 dark:text-red-400">
            La fecha de fin no puede ser anterior a la de inicio.
          </p>
        )}

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Estado</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          >
            {Object.entries(ESTADOS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <Acciones
          loading={loading}
          onClose={onClose}
          disabled={!number.trim() || !holder.trim() || !planId || fechasInvalidas}
        />
      </form>
    </Modal>
  );
}

export function Acciones({
  loading,
  onClose,
  disabled,
}: {
  loading: boolean;
  onClose: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={loading || disabled}
        className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
      >
        {loading ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  );
}

// B-15: objetivos de SLA de la aseguradora. Se miden contra estos tiempos los
// casos de sus afiliados; get_case_sla los lee.
function SlaTargets({ insurer, onSaved }: { insurer: Insurer; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [asig, setAsig] = useState(String(insurer.sla_assignment_minutes));
  const [lleg, setLleg] = useState(String(insurer.sla_arrival_minutes));
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const guardar = async () => {
    setSaving(true);
    const { error } = await createClient()
      .from('insurers')
      .update({
        sla_assignment_minutes: Math.max(1, Number(asig) || 0),
        sla_arrival_minutes: Math.max(1, Number(lleg) || 0),
      })
      .eq('id', insurer.id);
    setSaving(false);
    if (error) return toast.error('No se pudieron guardar los objetivos.');
    toast.success('Objetivos de SLA actualizados.');
    setEditing(false);
    onSaved();
  };

  return (
    <section className="mb-10 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">Objetivos de SLA</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-sm font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
          >
            Editar
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Asignar operador (min)</span>
            <input
              type="number"
              min={1}
              value={asig}
              onChange={(e) => setAsig(e.target.value)}
              className="w-28 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Llegar al lugar (min)</span>
            <input
              type="number"
              min={1}
              value={lleg}
              onChange={(e) => setLleg(e.target.value)}
              className="w-28 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </label>
          <button
            onClick={guardar}
            disabled={saving}
            className="rounded-lg bg-budi-primary-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <div className="flex gap-10">
          <div>
            <p className="text-xs text-zinc-500">Asignar operador</p>
            <p className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-white">
              {insurer.sla_assignment_minutes} <span className="text-sm font-normal text-zinc-500">min</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Llegar al lugar</p>
            <p className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-white">
              {insurer.sla_arrival_minutes} <span className="text-sm font-normal text-zinc-500">min</span>
            </p>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-500">
        Los servicios de los afiliados de esta aseguradora se miden contra estos tiempos.
      </p>
    </section>
  );
}
