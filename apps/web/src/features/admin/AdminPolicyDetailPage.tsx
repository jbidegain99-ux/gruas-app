'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Upload, UserCheck, UserX } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast, useConfirm } from '@/shared/components/FeedbackProvider';
import { formatDate, money } from '@/shared/lib/format';
import { Campo } from './AdminInsurersPage';
import { Acciones } from './AdminInsurerDetailPage';
import { MemberImportModal } from './MemberImportModal';
import { describeRule, sortRules, type CoverageRule } from './coverage-rules';

// Afiliados de una póliza (B-09), más un resumen legible de lo que cubre su plan.

type Policy = {
  id: string;
  policy_number: string;
  holder_name: string;
  starts_on: string;
  ends_on: string | null;
  status: string;
  insurer_id: string;
  plan_id: string;
  insurers: { name: string } | null;
  coverage_plans: { code: string; name: string; description: string | null } | null;
};

type Member = {
  id: string;
  policy_id: string;
  profile_id: string | null;
  document_number: string;
  full_name: string;
  phone: string | null;
  relationship: 'holder' | 'beneficiary';
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
  profiles: { full_name: string; email: string | null } | null;
};

export default function AdminPolicyDetailPage({ policyId }: { policyId: string }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [rules, setRules] = useState<CoverageRule[]>([]);
  /**
   * B-12: consumo por afiliado dentro del año de póliza. Es el criterio de
   * aceptación del ticket ("coverage_usage se decrementa correctamente por
   * afiliado"), así que tiene que poder verse, no solo estar en la tabla.
   * Solo cuentan los servicios completados: uno cancelado no gasta evento.
   */
  const [consumo, setConsumo] = useState<Record<string, { eventos: number; cubierto: number; copago: number }>>({});
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [form, setForm] = useState<{ open: boolean; member: Member | null }>({ open: false, member: null });
  const [importar, setImportar] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: pol } = await supabase
        .from('policies')
        .select('*, insurers(name), coverage_plans(code, name, description)')
        .eq('id', policyId)
        .single();

      const p = (pol as unknown as Policy) || null;
      setPolicy(p);

      const [mem, rul] = await Promise.all([
        supabase
          .from('members')
          .select('*, profiles(full_name, email)')
          .eq('policy_id', policyId)
          .order('relationship')
          .order('full_name'),
        p
          ? supabase.from('coverage_rules').select('*').eq('plan_id', p.plan_id)
          : Promise.resolve({ data: [] }),
      ]);

      const filas = (mem.data as unknown as Member[]) || [];
      setMembers(filas);

      // El año de póliza, no el calendario: una póliza que arranca el 31 de
      // diciembre tiene su año hasta el 30 del diciembre siguiente. Mismo
      // criterio que usa evaluate_coverage() en la DB.
      if (p && filas.length) {
        const inicio = new Date(p.starts_on + 'T00:00:00');
        const hoy = new Date();
        const aniversario = new Date(inicio);
        aniversario.setFullYear(inicio.getFullYear() + (hoy >= inicio ? hoy.getFullYear() - inicio.getFullYear() : 0));
        if (aniversario > hoy) aniversario.setFullYear(aniversario.getFullYear() - 1);
        const desde = aniversario.toISOString().slice(0, 10);

        const { data: usos } = await supabase
          .from('coverage_usage')
          .select('member_id, amount_covered, amount_copay, service_requests!inner(status)')
          .in('member_id', filas.map((m) => m.id))
          .gte('used_on', desde)
          .eq('service_requests.status', 'completed');

        const acc: Record<string, { eventos: number; cubierto: number; copago: number }> = {};
        for (const u of (usos ?? []) as unknown as {
          member_id: string; amount_covered: number | null; amount_copay: number | null;
        }[]) {
          const a = acc[u.member_id] ?? { eventos: 0, cubierto: 0, copago: 0 };
          a.eventos += 1;
          a.cubierto += Number(u.amount_covered ?? 0);
          a.copago += Number(u.amount_copay ?? 0);
          acc[u.member_id] = a;
        }
        setConsumo(acc);
      } else {
        setConsumo({});
      }
      setRules((rul.data as CoverageRule[]) || []);
      setLoading(false);
    };
    load();
  }, [policyId, refreshKey]);

  const handleDelete = async (m: Member) => {
    const ok = await confirm({
      title: `¿Eliminar a ${m.full_name}?`,
      message: 'Se eliminará también su historial de consumo de cobertura.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase.from('members').delete().eq('id', m.id);
    if (error) return toast.error('No se pudo eliminar al afiliado.');
    toast.success('Afiliado eliminado.');
    refetch();
  };

  const handleToggle = async (m: Member) => {
    const supabase = createClient();
    const { error } = await supabase.from('members').update({ is_active: !m.is_active }).eq('id', m.id);
    if (error) return toast.error('No se pudo actualizar al afiliado.');
    toast.success(m.is_active ? 'Afiliado desactivado.' : 'Afiliado activado.');
    refetch();
  };

  if (loading) return <p className="p-8 text-center text-sm text-zinc-500">Cargando…</p>;
  if (!policy) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-zinc-500">No se encontró la póliza.</p>
        <Link href="/admin/insurers" className="mt-2 inline-block text-sm text-budi-primary-600 hover:underline">
          Volver a aseguradoras
        </Link>
      </div>
    );
  }

  const vinculados = members.filter((m) => m.profile_id).length;

  return (
    <div>
      <Link
        href={`/admin/insurers/${policy.insurer_id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        {policy.insurers?.name ?? 'Aseguradora'}
      </Link>

      <div className="mb-8">
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">
          Póliza {policy.policy_number}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {/* El nombre del plan ya suele traer la palabra "Plan" (ej. "Plan Oro"),
              asi que no se antepone otra vez. */}
          Titular: {policy.holder_name} · {policy.coverage_plans?.name ?? 'Sin plan'} · Vigencia{' '}
          {formatDate(policy.starts_on)} — {policy.ends_on ? formatDate(policy.ends_on) : 'sin fin'}
        </p>
      </div>

      {/* Qué cubre — el admin no debería tener que abrir el plan para saberlo */}
      <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-heading text-base font-bold text-zinc-900 dark:text-white">
          Qué cubre este plan
        </h2>
        {rules.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">
            El plan todavía no tiene reglas de cobertura configuradas.{' '}
            <Link
              href={`/admin/insurers/${policy.insurer_id}`}
              className="text-budi-primary-600 hover:underline dark:text-budi-primary-400"
            >
              Configurarlas
            </Link>
          </p>
        ) : (
          <ul className="mt-3 space-y-1">
            {sortRules(rules).map((r) => (
              <li key={r.id} className="text-sm text-zinc-700 dark:text-zinc-300">
                · {describeRule(r)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Afiliados */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">Afiliados</h2>
            <p className="text-xs text-zinc-500">
              {members.length} en total · {vinculados} con cuenta en la app
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setImportar(true)}
              className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Upload className="h-4 w-4" />
              Importar CSV
            </button>
            <button
              onClick={() => setForm({ open: true, member: null })}
              className="flex items-center gap-2 rounded-lg bg-budi-primary-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-budi-primary-600"
            >
              <Plus className="h-4 w-4" />
              Agregar afiliado
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {members.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-500">
              Sin afiliados. Agrégalos a mano o importa el padrón desde un CSV.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <tr>
                    <th className="px-6 py-3">Afiliado</th>
                    <th className="px-6 py-3">DUI</th>
                    <th className="px-6 py-3">Teléfono</th>
                    <th className="px-6 py-3">Relación</th>
                    <th className="px-6 py-3">Cuenta</th>
                    <th className="px-6 py-3">Consumo del año</th>
                    <th className="px-6 py-3">Estado</th>
                    <th className="px-6 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {members.map((m) => (
                    <tr key={m.id} className="transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <td className="px-6 py-4 font-medium text-zinc-900 dark:text-white">{m.full_name}</td>
                      <td className="px-6 py-4 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                        {m.document_number}
                      </td>
                      <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400">{m.phone || '—'}</td>
                      <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400">
                        {m.relationship === 'holder' ? 'Titular' : 'Beneficiario'}
                      </td>
                      <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400">
                        {consumo[m.id] ? (
                          <span className="text-xs">
                            {consumo[m.id].eventos} servicio{consumo[m.id].eventos === 1 ? '' : 's'}
                            {' · '}
                            <span className="text-emerald-700 dark:text-emerald-400">
                              {money(consumo[m.id].cubierto)}
                            </span>
                            {consumo[m.id].copago > 0 && (
                              <>
                                {' / '}
                                <span className="text-amber-700 dark:text-amber-400">
                                  {money(consumo[m.id].copago)} copago
                                </span>
                              </>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-400 dark:text-zinc-600">Sin uso</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {m.profile_id ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                            <UserCheck className="h-3.5 w-3.5" />
                            {m.profiles?.email ?? 'vinculada'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                            <UserX className="h-3.5 w-3.5" />
                            Sin cuenta
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${
                            m.is_active
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                          }`}
                        >
                          {m.is_active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-3 text-xs font-medium">
                          <button
                            onClick={() => setForm({ open: true, member: m })}
                            className="text-budi-primary-600 hover:underline dark:text-budi-primary-400"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleToggle(m)}
                            className="text-zinc-600 hover:underline dark:text-zinc-400"
                          >
                            {m.is_active ? 'Desactivar' : 'Activar'}
                          </button>
                          <button
                            onClick={() => handleDelete(m)}
                            className="text-red-600 hover:underline dark:text-red-400"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {importar && (
        <MemberImportModal
          policyId={policyId}
          onClose={() => setImportar(false)}
          onImported={refetch}
        />
      )}

      {form.open && (
        <MemberForm
          policyId={policyId}
          member={form.member}
          onClose={() => setForm({ open: false, member: null })}
          onSaved={() => {
            setForm({ open: false, member: null });
            refetch();
          }}
        />
      )}
    </div>
  );
}

function MemberForm({
  policyId,
  member,
  onClose,
  onSaved,
}: {
  policyId: string;
  member: Member | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(member?.full_name || '');
  const [document, setDocument] = useState(member?.document_number || '');
  const [phone, setPhone] = useState(member?.phone || '');
  const [relationship, setRelationship] = useState<'holder' | 'beneficiary'>(
    member?.relationship || 'beneficiary'
  );
  const [startsOn, setStartsOn] = useState(member?.starts_on || new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState(member?.ends_on || '');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const fechasInvalidas = !!endsOn && endsOn < startsOn;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();

    // Si ya existe una cuenta con este DUI se vincula sola. Es el mismo match que
    // hará la importación masiva (B-10): el padrón casi siempre se carga antes de
    // que el afiliado se registre, así que `profile_id` suele quedar en null.
    let profileId = member?.profile_id ?? null;
    if (!profileId) {
      const { data: sensible } = await supabase
        .from('profile_sensitive')
        .select('profile_id')
        .eq('dui_number', document.trim())
        .maybeSingle();
      profileId = sensible?.profile_id ?? null;
    }

    const payload = {
      policy_id: policyId,
      profile_id: profileId,
      document_number: document.trim(),
      full_name: fullName.trim(),
      phone: phone.trim() || null,
      relationship,
      starts_on: startsOn,
      ends_on: endsOn || null,
    };

    const { error } = member
      ? await supabase.from('members').update(payload).eq('id', member.id)
      : await supabase.from('members').insert(payload);

    setLoading(false);
    if (error) {
      return toast.error(
        error.code === '23505'
          ? 'Ya hay un afiliado con ese DUI en esta póliza.'
          : 'No se pudo guardar al afiliado.'
      );
    }
    toast.success(member ? 'Afiliado actualizado.' : 'Afiliado agregado.');
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative z-50 w-full max-w-lg space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">
          {member ? 'Editar afiliado' : 'Nuevo afiliado'}
        </h2>

        <Campo label="Nombre completo" required value={fullName} onChange={setFullName} placeholder="Nombre y apellidos" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="DUI" required value={document} onChange={setDocument} placeholder="01234567-8" />
          <Campo label="Teléfono" value={phone} onChange={setPhone} placeholder="+503 7000-0000" />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Relación</label>
          <select
            value={relationship}
            onChange={(e) => setRelationship(e.target.value as 'holder' | 'beneficiary')}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          >
            <option value="holder">Titular</option>
            <option value="beneficiary">Beneficiario</option>
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Alta <span className="text-red-500">*</span>
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
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Baja</label>
            <input
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
        </div>

        {fechasInvalidas && (
          <p className="text-xs text-red-600 dark:text-red-400">
            La fecha de baja no puede ser anterior a la de alta.
          </p>
        )}

        <p className="text-xs text-zinc-500">
          Si ya existe una cuenta en la app con este DUI, queda vinculada automáticamente.
        </p>

        <Acciones
          loading={loading}
          onClose={onClose}
          disabled={!fullName.trim() || !document.trim() || fechasInvalidas}
        />
      </form>
    </div>
  );
}
