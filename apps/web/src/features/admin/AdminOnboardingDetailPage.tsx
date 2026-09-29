'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, ChevronRight, Circle } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useConfirm, useToast } from '@/shared/components/FeedbackProvider';
import { formatDateTime, money } from '@/shared/lib/format';
import { SERVICE_TYPE_KEYS, serviceTypeLabel } from '@/shared/components/ServiceTypeBadge';
import { ContractEditor } from '@/features/contracts/ContractEditor';
import { sendInvitationEmail } from '@/features/org/sendInvitationEmail';
import { invitationUrl, MEMBER_ROLE_LABELS, type MemberRole } from '@/features/org/org-links';
import {
  ORG_TYPE_LABEL,
  elapsedLabel,
  stepLink,
  stepTitle,
  type OnboardingStatus,
  type OnboardingStep,
  type PreviewResult,
} from './onboarding';

// Checklist del alta de un cliente institucional (migr. 00130, VEN-03). Cada
// paso dice si está hecho y se completa aquí mismo o en la página que enlaza.

const input = 'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';
const card = 'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';
const btn = 'rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700 disabled:opacity-50';
const muted = 'text-sm text-zinc-600 dark:text-zinc-400';

type Step<K extends OnboardingStep['key']> = Extract<OnboardingStep, { key: K }>;

export default function AdminOnboardingDetailPage({ organizationId }: { organizationId: string }) {
  const toast = useToast();
  const [s, setS] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((k) => k + 1), []);

  useEffect(() => {
    createClient()
      .rpc('admin_onboarding_status', { p_org: organizationId })
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setS(data as unknown as OnboardingStatus);
      });
  }, [organizationId, refresh]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!s) return <p className="text-sm text-zinc-500">Cargando…</p>;

  const org = s.organization;
  const done = s.steps.filter((x) => x.done).length;

  const complete = async () => {
    const { error: e } = await createClient().rpc('admin_complete_onboarding', { p_org: org.id, p_notes: null } as never);
    if (e) return toast.error(e.message);
    toast.success('Alta completa.');
    reload();
  };

  return (
    <div className="space-y-6">
      <Link href="/admin/altas" className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Altas de clientes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{ORG_TYPE_LABEL[org.type]}</p>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">{org.name}</h1>
          <p className={muted}>
            Inicio {formatDateTime(s.started_at)} ·{' '}
            {s.completed_at ? `alta completa en ${elapsedLabel(s.hours)}` : `${elapsedLabel(s.hours)} en curso`} · {done} de {s.steps.length} pasos
          </p>
        </div>
        {s.completed_at ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Alta completa · {formatDateTime(s.completed_at)}
          </span>
        ) : (
          <button onClick={complete} disabled={!s.ready} className={btn} title={s.ready ? undefined : 'Completa todos los pasos'}>
            Marcar alta completa
          </button>
        )}
      </div>

      <ol className="space-y-3">
        {s.steps.map((step, i) => {
          const href = stepLink(step.key, org);
          return (
            <li key={step.key} className={`${card} p-4`}>
              <div className="flex items-start gap-3">
                {step.done ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Hecho" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-zinc-300 dark:text-zinc-600" aria-label="Pendiente" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold text-zinc-900 dark:text-white">
                      {i + 1}. {stepTitle(step.key, org.type)}
                    </h2>
                    {href && (
                      <Link href={href} className="inline-flex items-center text-xs font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                        Abrir <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                  <div className="mt-1">
                    {step.key === 'org' && <p className={muted}>{step.detail}</p>}
                    {step.key === 'contract' && <ContractStep step={step} org={org} />}
                    {step.key === 'owner' && <OwnerStep step={step} orgId={org.id} onChange={reload} />}
                    {step.key === 'members' && <MembersStep step={step} />}
                    {step.key === 'zones' && (
                      <p className={muted}>
                        {step.zones > 0 ? `${step.zones} zona(s) activa(s).` : 'Sin zonas activas: dibuja al menos una zona del programa.'}
                      </p>
                    )}
                    {step.key === 'test' && <TestStep step={step} org={org} onChange={reload} />}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ContractStep({ step, org }: { step: Step<'contract'>; org: OnboardingStatus['organization'] }) {
  return (
    <div className="space-y-2">
      <p className={muted}>
        {step.contract
          ? `Contrato ${step.contract.reference}, vigente desde ${step.contract.valid_from}${step.contract.valid_to ? ` hasta ${step.contract.valid_to}` : ''}${
              step.contract.monthly_cap != null ? ` · tope mensual ${money(step.contract.monthly_cap)}` : ''
            }.`
          : 'Sin contrato registrado.'}{' '}
        SLA: asignación {step.sla_assignment_minutes} min, llegada {step.sla_arrival_minutes} min.
        {org.type === 'MOPT' &&
          (step.fee_set
            ? ` Tarifa de Budi: ${((step.fee ?? 0) * 100).toLocaleString('es-SV', { maximumFractionDigits: 2 })} % por servicio.`
            : ' Falta fijar la tarifa de Budi por servicio (en Programas MOPT).')}
      </p>
      <ContractEditor organizationId={org.id} />
    </div>
  );
}

function OwnerStep({ step, orgId, onChange }: { step: Step<'owner'>; orgId: string; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('owner');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const invite = async (to: string, r: string) => {
    setBusy(true);
    const { data, error } = await createClient().rpc('admin_invite_org_member', { p_org: orgId, p_email: to, p_role: r });
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    const inv = data as unknown as { token: string; email: string };
    const sent = await sendInvitationEmail(inv.email, inv.token);
    setBusy(false);
    if (sent.ok) toast.success(`Invitación enviada a ${inv.email}.`);
    else {
      // Sin correo (p. ej. límite de envíos): el enlace sirve igual, se comparte a mano.
      setLink(invitationUrl(window.location.origin, inv.token));
      toast.info('No se pudo mandar el correo; comparte el enlace a mano.');
    }
    setEmail('');
    onChange();
  };

  const revoke = async (id: string, to: string) => {
    if (!(await confirm({ title: `¿Anular la invitación a ${to}?`, confirmLabel: 'Anular', destructive: true }))) return;
    const { error } = await createClient().rpc('admin_revoke_org_invitation', { p_id: id });
    if (error) return toast.error(error.message);
    onChange();
  };

  return (
    <div className="space-y-3">
      <p className={muted}>
        {step.owner
          ? `${step.owner.name ? `${step.owner.name} (${step.owner.email})` : step.owner.email} es dueño del portal. Entra con 2FA.`
          : 'Nadie es dueño todavía. Invítalo por correo: si no tiene cuenta, el enlace se la crea.'}
      </p>
      {step.invitations.length > 0 && (
        <ul className="space-y-1 text-sm">
          {step.invitations.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-zinc-900 dark:text-white">{inv.email}</span>
              <span className="text-xs text-zinc-500">
                {MEMBER_ROLE_LABELS[inv.role as MemberRole] ?? inv.role} ·{' '}
                {inv.expired ? 'venció' : `pendiente hasta ${formatDateTime(inv.expires_at)}`}
              </span>
              <button onClick={() => invite(inv.email, inv.role)} disabled={busy} className="text-xs font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                Reenviar
              </button>
              <button onClick={() => revoke(inv.id, inv.email)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                Anular
              </button>
            </li>
          ))}
        </ul>
      )}
      {link && (
        <p className="break-all rounded-lg bg-zinc-50 p-2 font-mono text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">{link}</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1 text-sm">
          Correo
          <input type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="gerente@cliente.com" />
        </label>
        <label className="text-sm">
          Rol
          <select className={input} value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
            {(['owner', 'admin', 'analyst', 'viewer'] as MemberRole[]).map((r) => (
              <option key={r} value={r}>{MEMBER_ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>
        <button onClick={() => invite(email, role)} disabled={busy || !email.trim()} className={btn}>
          {busy ? 'Enviando…' : 'Invitar'}
        </button>
      </div>
    </div>
  );
}

function MembersStep({ step }: { step: Step<'members'> }) {
  const items = [
    { ok: step.plans > 0 && step.rules > 0, text: `${step.plans} plan(es) activo(s) con ${step.rules} regla(s) de cobertura` },
    { ok: step.policies > 0, text: `${step.policies} póliza(s) vigente(s)` },
    { ok: step.members > 0, text: `${step.members.toLocaleString('es-SV')} afiliado(s) activo(s) (carga por CSV o API)` },
  ];
  return (
    <ul className="space-y-0.5 text-sm">
      {items.map((it) => (
        <li key={it.text} className={it.ok ? 'text-zinc-700 dark:text-zinc-300' : 'text-amber-700 dark:text-amber-400'}>
          {it.ok ? '✓' : '•'} {it.text}
        </li>
      ))}
    </ul>
  );
}

function TestStep({ step, org, onChange }: { step: Step<'test'>; org: OnboardingStatus['organization']; onChange: () => void }) {
  const toast = useToast();
  const [service, setService] = useState('tow');
  const [doc, setDoc] = useState('');
  const [total, setTotal] = useState('100');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(step.last_result);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const { data, error } = await createClient().rpc('admin_preview_eligibility', {
      p_org: org.id, p_service_type: service,
      p_document: org.type === 'INSURER' ? doc : null,
      p_lat: org.type === 'MOPT' ? Number(lat) : null,
      p_lng: org.type === 'MOPT' ? Number(lng) : null,
      p_total: Number(total) || 100,
    } as never);
    setBusy(false);
    if (error) return toast.error(error.message);
    setResult(data as unknown as PreviewResult);
    onChange();
  };

  return (
    <div className="space-y-3">
      <p className={muted}>
        {org.type === 'INSURER'
          ? 'Busca a un afiliado real del padrón y comprueba que el plan cubre el servicio. No crea servicios ni gasta cobertura.'
          : 'Elige un punto dentro de una zona del programa y comprueba que el servicio sale como cortesía MOPT. No crea servicios.'}
        {step.passed_at && ` Última prueba exitosa: ${formatDateTime(step.passed_at)}.`}
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-sm">
          Servicio
          <select className={input} value={service} onChange={(e) => setService(e.target.value)}>
            {SERVICE_TYPE_KEYS.map((k) => <option key={k} value={k}>{serviceTypeLabel(k)}</option>)}
          </select>
        </label>
        {org.type === 'INSURER' ? (
          <>
            <label className="text-sm sm:col-span-2">DUI o documento<input className={input} value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="01234567-8" /></label>
            <label className="text-sm">Precio del servicio<input className={input} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></label>
          </>
        ) : (
          <>
            <label className="text-sm">Latitud<input className={input} inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="13.55" /></label>
            <label className="text-sm">Longitud<input className={input} inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-89.32" /></label>
          </>
        )}
      </div>
      <button onClick={run} disabled={busy || (org.type === 'INSURER' ? !doc.trim() : !lat || !lng)} className={btn}>
        {busy ? 'Probando…' : 'Probar'}
      </button>
      {result && (
        <div
          role="status"
          className={`rounded-lg p-3 text-sm ${
            result.ok
              ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200'
              : 'bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200'
          }`}
        >
          <p className="font-medium">{result.ok ? (org.type === 'INSURER' ? 'Cubierto' : 'Cortesía MOPT') : 'No aplica'}</p>
          {result.reason && <p>{result.reason}</p>}
          {result.member && (
            <p>
              {result.member} · póliza {result.policy_number}
              {result.plan ? ` · ${result.plan}` : ''}
            </p>
          )}
          {result.ok && result.amount_total != null && (
            <p>
              Servicio {money(result.amount_total)}: la aseguradora cubre {money(result.amount_covered)}, el afiliado paga{' '}
              {money(result.amount_copay)}
              {result.services_per_year != null && ` · ${result.events_used ?? 0} de ${result.services_per_year} servicios usados este año`}
            </p>
          )}
          {result.zones && result.zones.length > 0 && (
            <p>
              Zonas en ese punto:{' '}
              {result.zones
                .map((z) => `${z.zone}${!z.is_active ? ' (inactiva)' : !z.serves ? ' (no atiende este servicio)' : !z.open_now ? ' (fuera de horario)' : ''}`)
                .join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
