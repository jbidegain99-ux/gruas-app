'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { formatDate } from '@/shared/lib/format';

// Equipo de una organización (migr. 00106, backlog POR-01): quién entra a su
// portal y con qué rol interno. El acceso lo da esta membresía, no el rol del
// perfil. La invitación por correo que hace el propio owner es POR-02.

type Member = {
  profile_id: string;
  full_name: string | null;
  email: string | null;
  role: MemberRole;
  status: 'active' | 'disabled';
  created_at: string;
};

type MemberRole = 'owner' | 'admin' | 'analyst' | 'viewer';

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Dueño de la cuenta',
  admin: 'Administrador',
  analyst: 'Analista',
  viewer: 'Solo lectura',
};

const input =
  'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white';

export function OrgMembersPanel({ organizationId, title = 'Equipo del portal' }: { organizationId: string; title?: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('viewer');
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // 00120: restablecer el 2FA de quien perdió su teléfono (fila abierta + motivo).
  const [mfaFor, setMfaFor] = useState<string | null>(null);
  const [mfaReason, setMfaReason] = useState('');
  const toast = useToast();

  const load = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    const fetchMembers = async () => {
      const { data, error } = await createClient().rpc('admin_org_members', { p_organization_id: organizationId });
      if (!alive) return;
      if (error) toast.error(`No se pudo cargar el equipo: ${error.message}`);
      setMembers((data ?? []) as Member[]);
      setLoading(false);
    };
    fetchMembers();
    return () => {
      alive = false;
    };
  }, [organizationId, refreshKey, toast]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSaving(true);
    const { error } = await createClient().rpc('admin_add_org_member', {
      p_organization_id: organizationId,
      p_email: email.trim(),
      p_role: role,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Persona agregada al equipo.');
    setEmail('');
    load();
  };

  const update = async (m: Member, patch: { p_role?: MemberRole; p_status?: 'active' | 'disabled' }) => {
    const { error } = await createClient().rpc('admin_update_org_member', {
      p_organization_id: organizationId,
      p_profile_id: m.profile_id,
      ...patch,
    });
    if (error) return toast.error(error.message);
    toast.success(patch.p_status === 'disabled' ? 'Acceso desactivado: sale del portal en su siguiente clic.' : 'Equipo actualizado.');
    load();
  };

  const resetMfa = async (m: Member) => {
    const { error } = await createClient().rpc('admin_reset_mfa', { p_profile_id: m.profile_id, p_reason: mfaReason });
    if (error) return toast.error(error.message);
    toast.success('2FA restablecido: al volver a entrar tendrá que configurarlo de nuevo.');
    setMfaFor(null);
    setMfaReason('');
  };

  return (
    <section className="mb-10 rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <Users className="h-4 w-4 text-zinc-400" />
        <h2 className="font-semibold text-zinc-900 dark:text-white">{title}</h2>
      </div>

      {loading ? (
        <p className="px-5 py-4 text-sm text-zinc-500">Cargando…</p>
      ) : members.length === 0 ? (
        <p className="px-5 py-4 text-sm text-zinc-500">Nadie tiene acceso todavía. Agrega a la primera persona abajo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-2 font-medium">Persona</th>
                <th className="px-5 py-2 font-medium">Rol en el portal</th>
                <th className="px-5 py-2 font-medium">Desde</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {members.map((m) => (
                <Fragment key={m.profile_id}>
                <tr className={m.status === 'disabled' ? 'opacity-50' : ''}>
                  <td className="px-5 py-2">
                    <p className="font-medium text-zinc-900 dark:text-white">{m.full_name || '—'}</p>
                    <p className="text-xs text-zinc-500">{m.email}</p>
                  </td>
                  <td className="px-5 py-2">
                    <select
                      value={m.role}
                      disabled={m.status === 'disabled'}
                      onChange={(e) => update(m, { p_role: e.target.value as MemberRole })}
                      className={input}
                      aria-label={`Rol de ${m.full_name ?? m.email}`}
                    >
                      {(Object.keys(MEMBER_ROLE_LABELS) as MemberRole[]).map((r) => (
                        <option key={r} value={r}>{MEMBER_ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-5 py-2 text-zinc-500">{formatDate(m.created_at)}</td>
                  <td className="whitespace-nowrap px-5 py-2 text-right">
                    <button
                      onClick={() => update(m, { p_status: m.status === 'active' ? 'disabled' : 'active' })}
                      className={`text-xs font-medium hover:underline ${m.status === 'active' ? 'text-red-600 dark:text-red-400' : 'text-budi-primary-600 dark:text-budi-primary-400'}`}
                    >
                      {m.status === 'active' ? 'Quitar acceso' : 'Devolver acceso'}
                    </button>
                    {m.status === 'active' && (
                      <button
                        onClick={() => {
                          setMfaFor(mfaFor === m.profile_id ? null : m.profile_id);
                          setMfaReason('');
                        }}
                        className="ml-3 text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-400"
                      >
                        Restablecer 2FA
                      </button>
                    )}
                  </td>
                </tr>
                {mfaFor === m.profile_id && (
                  <tr>
                    <td colSpan={4} className="bg-amber-50 px-5 py-3 dark:bg-amber-950/40">
                      <p className="mb-2 text-xs text-amber-900 dark:text-amber-200">
                        Solo si perdió su teléfono y verificaste que es la persona. Se cierran sus sesiones y queda en la bitácora.
                      </p>
                      <div className="flex gap-2">
                        <input
                          value={mfaReason}
                          onChange={(e) => setMfaReason(e.target.value)}
                          placeholder="Cómo lo verificaste (ej.: videollamada con su DUI)"
                          className={`${input} flex-1`}
                        />
                        <button
                          onClick={() => resetMfa(m)}
                          disabled={!mfaReason.trim()}
                          className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          Restablecer
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={add} className="flex flex-col gap-2 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800 sm:flex-row sm:items-center">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Correo de una cuenta ya registrada"
          className={`${input} flex-1`}
          aria-label="Correo"
        />
        <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} className={input} aria-label="Rol">
          {(Object.keys(MEMBER_ROLE_LABELS) as MemberRole[]).map((r) => (
            <option key={r} value={r}>{MEMBER_ROLE_LABELS[r]}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={saving || !email.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" /> Agregar
        </button>
      </form>
    </section>
  );
}
