'use client';

import { useEffect, useState } from 'react';
import { Copy, History, ShieldCheck, ShieldAlert, UserPlus, Users } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useConfirm, useToast } from '@/shared/components/FeedbackProvider';
import { formatDate } from '@/shared/lib/format';
import { assignableRoles, invitationUrl, MEMBER_ROLE_LABELS, requiresMfa, type MemberRole } from './org-links';
import { sendInvitationEmail } from './sendInvitationEmail';

// Equipo del portal de una organización (migr. 00113, backlog POR-02): el
// dueño o un administrador invita por correo, asigna roles y quita accesos;
// cualquiera del equipo ve quién más está. La base valida cada regla (quién
// maneja a quién, nunca sin dueño, 2FA) — esto solo no ofrece lo que igual
// sería rechazado.

type Member = {
  profile_id: string;
  full_name: string | null;
  email: string | null;
  role: MemberRole;
  status: 'active' | 'disabled';
  created_at: string;
  is_me: boolean;
  has_mfa: boolean;
};

type Invitation = {
  id: string;
  email: string;
  role: MemberRole;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
  expired: boolean;
};

type Team = { my_role: MemberRole; can_manage: boolean; members: Member[]; invitations: Invitation[] };
type LogRow = { occurred_at: string; kind: 'acceso' | 'equipo'; who: string; what: string };

const input =
  'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white';
const card = 'rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900';

export default function OrgTeamPage() {
  const [team, setTeam] = useState<Team | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('viewer');
  const [sending, setSending] = useState(false);
  const [lastLink, setLastLink] = useState<{ email: string; url: string } | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const supabase = createClient();
      const { data, error: e } = await supabase.rpc('org_team');
      if (!alive) return;
      setError(e?.message ?? null);
      const t = (data as unknown as Team) ?? null;
      setTeam(t);
      if (t?.can_manage) {
        const { data: rows } = await supabase.rpc('org_access_log', { p_limit: 100 });
        if (alive) setLog((rows as LogRow[]) ?? []);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    const { data, error: e1 } = await createClient().rpc('org_invite', { p_email: email.trim(), p_role: role });
    if (e1) {
      setSending(false);
      return toast.error(e1.message);
    }
    const inv = data as unknown as { token: string; email: string };
    const url = invitationUrl(window.location.origin, inv.token);
    const sent = await sendInvitationEmail(inv.email, inv.token);
    setSending(false);
    setLastLink({ email: inv.email, url });
    if (sent.ok) toast.success(`Invitación enviada a ${inv.email}.`);
    else toast.info(`Invitación creada, pero el correo no salió (${sent.error}). Copia el enlace y compártelo.`);
    setEmail('');
    refresh();
  };

  const update = async (m: Member, patch: { p_role?: MemberRole; p_status?: 'active' | 'disabled' }) => {
    if (patch.p_status === 'disabled') {
      const ok = await confirm({
        title: `¿Quitar el acceso a ${m.full_name ?? m.email}?`,
        message: 'Deja de ver el portal en su siguiente clic. Puedes devolvérselo después.',
        confirmLabel: 'Quitar acceso',
        destructive: true,
      });
      if (!ok) return;
    }
    if (patch.p_role === 'owner' && m.role !== 'owner') {
      // Dueño es el rol con más poder (asigna administradores y aprueba pagos):
      // un cambio accidental en el selector no debe aplicarse sin confirmar.
      const ok = await confirm({
        title: `¿Hacer a ${m.full_name ?? m.email} dueño de la cuenta?`,
        message: 'Tendrá los mismos permisos que tú: administrar el equipo, aprobar estados de cuenta y registrar pagos.',
        confirmLabel: 'Hacer dueño',
      });
      if (!ok) return;
    }
    const { error: e } = await createClient().rpc('org_update_member', { p_profile_id: m.profile_id, ...patch });
    if (e) return toast.error(e.message);
    toast.success('Equipo actualizado.');
    refresh();
  };

  const revoke = async (inv: Invitation) => {
    const { error: e } = await createClient().rpc('org_revoke_invitation', { p_id: inv.id });
    if (e) return toast.error(e.message);
    toast.success('Invitación anulada.');
    refresh();
  };

  if (error) {
    return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>;
  }
  if (!team) return <p className="text-sm text-zinc-500">Cargando…</p>;

  const roles = assignableRoles(team.my_role);
  const canTouch = (m: Member) => team.can_manage && !m.is_me && (team.my_role === 'owner' || !requiresMfa(m.role));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Equipo</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Quién entra a este portal y con qué permisos. El dueño y los administradores usan verificación en dos pasos.
        </p>
      </div>

      <section className={card}>
        <h2 className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3 font-semibold text-zinc-900 dark:border-zinc-800 dark:text-white">
          <Users className="h-4 w-4 text-zinc-400" /> Personas
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-2 font-medium">Persona</th>
                <th className="px-5 py-2 font-medium">Rol</th>
                <th className="px-5 py-2 font-medium">2FA</th>
                <th className="px-5 py-2 font-medium">Desde</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {team.members.map((m) => (
                <tr key={m.profile_id} className={m.status === 'disabled' ? 'opacity-50' : ''}>
                  <td className="px-5 py-2">
                    <p className="font-medium text-zinc-900 dark:text-white">
                      {m.full_name || '—'} {m.is_me && <span className="text-xs font-normal text-zinc-500">(tú)</span>}
                    </p>
                    <p className="text-xs text-zinc-500">{m.email}</p>
                  </td>
                  <td className="px-5 py-2">
                    {canTouch(m) && m.status === 'active' ? (
                      <select
                        value={m.role}
                        onChange={(e) => update(m, { p_role: e.target.value as MemberRole })}
                        className={input}
                        aria-label={`Rol de ${m.full_name ?? m.email}`}
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>{MEMBER_ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {MEMBER_ROLE_LABELS[m.role]}
                        {m.status === 'disabled' && ' · sin acceso'}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2">
                    {m.has_mfa ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-300">
                        <ShieldCheck className="h-3.5 w-3.5" /> Activo
                      </span>
                    ) : requiresMfa(m.role) ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                        <ShieldAlert className="h-3.5 w-3.5" /> Pendiente
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400">No requerido</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2 text-zinc-500">{formatDate(m.created_at)}</td>
                  <td className="whitespace-nowrap px-5 py-2 text-right">
                    {canTouch(m) && (
                      <button
                        onClick={() => update(m, { p_status: m.status === 'active' ? 'disabled' : 'active' })}
                        className={`text-xs font-medium hover:underline ${m.status === 'active' ? 'text-red-600 dark:text-red-400' : 'text-budi-primary-600 dark:text-budi-primary-400'}`}
                      >
                        {m.status === 'active' ? 'Quitar acceso' : 'Devolver acceso'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {team.can_manage && (
        <section className={card}>
          <h2 className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3 font-semibold text-zinc-900 dark:border-zinc-800 dark:text-white">
            <UserPlus className="h-4 w-4 text-zinc-400" /> Invitar
          </h2>
          <form onSubmit={invite} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@empresa.com"
              className={`${input} flex-1`}
              aria-label="Correo de la persona"
            />
            <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} className={input} aria-label="Rol">
              {roles.map((r) => (
                <option key={r} value={r}>{MEMBER_ROLE_LABELS[r]}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" /> {sending ? 'Enviando…' : 'Enviar invitación'}
            </button>
          </form>
          <p className="px-5 pb-3 text-xs text-zinc-500">
            Le llega un correo con un enlace de acceso. La invitación vence en 7 días y solo sirve para ese correo.
          </p>

          {lastLink && (
            <div className="mx-5 mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60">
              <span className="text-zinc-600 dark:text-zinc-300">Enlace para {lastLink.email}:</span>
              <code className="min-w-0 flex-1 select-all truncate font-mono text-zinc-500">{lastLink.url}</code>
              <button
                onClick={async () => {
                  // Sin permiso de portapapeles (http, iframe) writeText rechaza:
                  // antes decía "copiado" igual.
                  try {
                    await navigator.clipboard.writeText(lastLink.url);
                    toast.success('Enlace copiado.');
                  } catch {
                    toast.error('No se pudo copiar. Selecciona el enlace a mano.');
                  }
                }}
                className="inline-flex items-center gap-1 font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
              >
                <Copy className="h-3.5 w-3.5" /> Copiar
              </button>
            </div>
          )}

          {team.invitations.length > 0 && (
            <div className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Pendientes</p>
              <ul className="space-y-2 text-sm">
                {team.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-zinc-800 dark:text-zinc-200">
                      {i.email} · {MEMBER_ROLE_LABELS[i.role]}
                      <span className="ml-2 text-xs text-zinc-500">
                        {i.expired ? 'vencida' : `vence el ${formatDate(i.expires_at)}`}
                        {i.invited_by_name ? ` · invitó ${i.invited_by_name}` : ''}
                      </span>
                    </span>
                    {(team.my_role === 'owner' || !requiresMfa(i.role)) && (
                      <button onClick={() => revoke(i)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                        Anular
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {team.can_manage && (
        <section className={card}>
          <h2 className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3 font-semibold text-zinc-900 dark:border-zinc-800 dark:text-white">
            <History className="h-4 w-4 text-zinc-400" /> Bitácora de accesos
          </h2>
          {log.length === 0 ? (
            <p className="px-5 py-4 text-sm text-zinc-500">Todavía no hay actividad registrada.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto text-sm dark:divide-zinc-800">
              {log.map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 px-5 py-2">
                  <span className="text-zinc-800 dark:text-zinc-200">
                    <span
                      className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        r.kind === 'acceso'
                          ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                          : 'bg-budi-primary-50 text-budi-primary-700 dark:bg-budi-primary-900/40 dark:text-budi-primary-300'
                      }`}
                    >
                      {r.kind === 'acceso' ? 'Acceso' : 'Equipo'}
                    </span>
                    <strong className="font-medium">{r.who}</strong> {r.what.charAt(0).toLowerCase() + r.what.slice(1)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {new Intl.DateTimeFormat('es-SV', {
                      timeZone: 'America/El_Salvador',
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(r.occurred_at))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
