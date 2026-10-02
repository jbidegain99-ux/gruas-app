'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Circle, Clock, FileUp, PauseCircle, Send, XCircle } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { LogoutButton } from '@/shared/components/LogoutButton';
import { FeedbackProvider, useToast } from '@/shared/components/FeedbackProvider';
import { formatDate } from '@/shared/lib/format';
import { TermsSection } from './TermsSection';
import { normalizeSvPhone, PARTNER_SERVICES, PARTNER_VEHICLE_TYPES } from './partner-options';
import {
  canUpload,
  DOC_LABEL,
  DOCS,
  formatDui,
  formatNit,
  STATE_LABEL,
  stepStatus,
  uploadPath,
  type AppDocument,
  type DocType,
  type PartnerApplication,
} from './partner-application';

// Registro completo del socio operador en la web (backlog AGT-02, migr. 00114):
// se puede hacer sin descargar la app. Cada sección se guarda por separado,
// así el socio completa en varias sesiones. La app móvil usa las mismas RPC.

const input =
  'mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-budi-primary-500 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:disabled:bg-zinc-900';
const card = 'rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900';
const btn =
  'rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-600 disabled:cursor-not-allowed disabled:opacity-50';

const MISSING_LABEL: Record<string, string> = {
  identidad: 'Datos personales',
  unidad: 'Tu unidad',
  servicios: 'Servicios que prestas',
  cuenta_bancaria: 'Cuenta bancaria',
  contrato: 'Aceptar el contrato',
};
const missingLabel = (m: string) =>
  m.startsWith('documento:') ? DOC_LABEL[m.slice('documento:'.length) as DocType] ?? m : MISSING_LABEL[m] ?? m;

const BANKS = ['Banco Agrícola', 'Banco Cuscatlán', 'Banco de América Central (BAC)', 'Banco Davivienda', 'Banco Hipotecario', 'Banco Promerica', 'Banco Azul', 'Banco Atlántida', 'Banco Industrial', 'Fedecrédito'];

type Session = { status: 'loading' } | { status: 'anon' } | { status: 'not-operator' } | { status: 'ready'; uid: string };

function Registration() {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const [app, setApp] = useState<PartnerApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const reload = useCallback(async () => {
    const { data, error: e } = await createClient().rpc('my_partner_application');
    if (e) setError(e.message);
    else setApp(data as unknown as PartnerApplication);
  }, []);

  useEffect(() => {
    const start = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) return setSession({ status: 'anon' });
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
      if (prof?.role !== 'OPERATOR') return setSession({ status: 'not-operator' });
      setSession({ status: 'ready', uid: data.user.id });
      const { data: res, error: e } = await supabase.rpc('my_partner_application');
      if (e) setError(e.message);
      else setApp(res as unknown as PartnerApplication);
    };
    start();
  }, []);

  // Guardar una sección: llama a la RPC y recarga el avance.
  const save = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { error: e } = await createClient().rpc(fn as 'my_partner_application', args as never);
    if (e) {
      toast.error(e.message);
      return false;
    }
    toast.success(ok);
    await reload();
    return true;
  };

  if (session.status === 'loading') return <p className="py-16 text-center text-sm text-zinc-500">Cargando…</p>;
  if (session.status === 'anon') return <SignupCard />;
  if (session.status === 'not-operator') {
    return (
      <div className={`${card} mx-auto max-w-md text-center`}>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Esta cuenta es de <strong>Usuario</strong>. Para ser socio operador crea una cuenta nueva con otro correo.
        </p>
        <div className="mt-4 flex justify-center"><LogoutButton /></div>
      </div>
    );
  }
  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>;
  if (!app) return <p className="py-16 text-center text-sm text-zinc-500">Cargando…</p>;

  const steps = stepStatus(app);
  const locked = !app.can_edit;

  return (
    <div className="space-y-5">
      <StateBanner app={app} />

      <Section title="1. Datos personales" done={steps.identity}>
        <IdentityForm app={app} locked={locked} onSave={save} />
      </Section>

      <Section title="2. Tu unidad" done={steps.vehicle}>
        <VehicleForm app={app} locked={locked} onSave={save} />
      </Section>

      {app.independent && (
        <Section title="3. Servicios que prestas" done={steps.services}>
          <ServicesForm app={app} locked={locked} onSave={save} />
        </Section>
      )}

      {app.independent && (
        <Section title={`${app.independent ? '4' : '3'}. Cuenta bancaria para tus pagos`} done={steps.bank}>
          <BankForm app={app} locked={locked} onSave={save} />
        </Section>
      )}

      <Section title={`${app.independent ? '5' : '3'}. Documentos`} done={steps.documents}>
        <Documents app={app} uid={session.uid} onUploaded={reload} />
      </Section>

      <Section title={`${app.independent ? '6' : '4'}. Contrato`} done={steps.contract}>
        <TermsSection app={app} onAccept={(id) => save('accept_terms', { p_terms_id: id }, 'Contrato aceptado.')} />
      </Section>

      {app.can_edit && (
        <div className={card}>
          <h2 className="font-semibold text-zinc-900 dark:text-white">Enviar a revisión</h2>
          {app.missing.length > 0 ? (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Te falta: {app.missing.map(missingLabel).join(', ')}.
            </p>
          ) : (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Todo listo. Revisamos tu registro en pocos días hábiles y te avisamos.</p>
          )}
          <button
            className={`${btn} mt-4 inline-flex items-center gap-2`}
            disabled={app.missing.length > 0}
            onClick={() => save('submit_operator_verification', {}, 'Registro enviado. Te avisamos cuando lo revisemos.')}
          >
            <Send className="h-4 w-4" /> Enviar a revisión
          </button>
        </div>
      )}
    </div>
  );
}

function StateBanner({ app }: { app: PartnerApplication }) {
  const styles: Record<PartnerApplication['state'], { cls: string; Icon: typeof Clock; text: string }> = {
    draft: { cls: 'bg-budi-primary-50 text-budi-primary-900 dark:bg-budi-primary-950/40 dark:text-budi-primary-200', Icon: Circle, text: 'Completa cada sección; puedes guardar y seguir otro día.' },
    in_review: { cls: 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200', Icon: Clock, text: 'Estamos revisando tu registro. Mientras tanto no se puede cambiar.' },
    approved: { cls: 'bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200', Icon: CheckCircle2, text: 'Tu cuenta está activa: entra a la app y ponte en línea para recibir solicitudes.' },
    rejected: { cls: 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200', Icon: XCircle, text: 'Corrige lo que te indicamos abajo y vuelve a enviarlo.' },
    // La pausa automática (documento vencido) se resuelve subiendo la
    // renovación; la que pone Budi a mano, hablando con soporte.
    suspended: {
      cls: 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200',
      Icon: PauseCircle,
      text: /^Documento vencido/i.test(app.rejection_reason ?? '')
        ? 'Sube el documento renovado para volver a recibir solicitudes.'
        : 'Budi pausó tu cuenta. Escríbenos a soporte para resolverlo.',
    },
  };
  const s = styles[app.state];
  return (
    <div className={`flex gap-3 rounded-xl p-4 ${s.cls}`}>
      <s.Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="text-sm">
        <p className="font-semibold">{STATE_LABEL[app.state]}</p>
        <p>{s.text}</p>
        {app.rejection_reason && (app.state === 'rejected' || app.state === 'suspended') && (
          <p className="mt-1"><strong>Motivo:</strong> {app.rejection_reason}</p>
        )}
      </div>
    </div>
  );
}

function Section({ title, done, children }: { title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className={card}>
      <h2 className="mb-4 flex items-center gap-2 font-semibold text-zinc-900 dark:text-white">
        {done ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <Circle className="h-5 w-5 text-zinc-300" />}
        {title}
      </h2>
      {children}
    </section>
  );
}

type SaveFn = (fn: string, args: Record<string, unknown>, ok: string) => Promise<boolean>;

function IdentityForm({ app, locked, onSave }: { app: PartnerApplication; locked: boolean; onSave: SaveFn }) {
  const [name, setName] = useState(app.identity.full_name ?? '');
  const [phone, setPhone] = useState(app.identity.phone ?? '');
  const [dui, setDui] = useState(app.identity.dui ?? '');
  const [nit, setNit] = useState(app.identity.nit ?? '');
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = formatDui(dui);
    const n = formatNit(nit);
    const t = normalizeSvPhone(phone);
    if (!t) return setErr('Teléfono de El Salvador de 8 dígitos.');
    if (!d) return setErr('El DUI tiene 9 dígitos: ########-#.');
    if (!n) return setErr('El NIT tiene 14 dígitos: ####-######-###-#.');
    setErr(null);
    await onSave('partner_save_identity', { p_full_name: name, p_phone: t, p_dui: d, p_nit: n }, 'Datos personales guardados.');
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {err && <p className="text-sm text-red-600 sm:col-span-2">{err}</p>}
      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 sm:col-span-2">Nombre completo (como en tu DUI)
        <input required disabled={locked} value={name} onChange={(e) => setName(e.target.value)} className={input} />
      </label>
      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Teléfono
        <input required disabled={locked} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="7012-3456" className={input} />
      </label>
      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">DUI
        <input required disabled={locked} value={dui} onChange={(e) => setDui(e.target.value)} placeholder="01234567-8" className={input} />
      </label>
      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 sm:col-span-2">NIT
        <input required disabled={locked} value={nit} onChange={(e) => setNit(e.target.value)} placeholder="0614-010190-101-1" className={input} />
      </label>
      {!locked && <div className="sm:col-span-2"><button className={btn}>Guardar</button></div>}
    </form>
  );
}

function VehicleForm({ app, locked, onSave }: { app: PartnerApplication; locked: boolean; onSave: SaveFn }) {
  const [plate, setPlate] = useState(app.vehicle?.plate ?? '');
  const [type, setType] = useState(app.vehicle?.vehicle_type ?? 'tow_light');
  const [cap, setCap] = useState(app.vehicle?.capacity_m3 == null ? '' : String(app.vehicle.capacity_m3));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(
      'partner_save_vehicle',
      { p_plate: plate, p_vehicle_type: type, ...(type === 'water_truck' ? { p_capacity_m3: Number(cap) } : {}) },
      'Unidad guardada.'
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Placa
        <input required disabled={locked} value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="P123-456" className={`${input} font-mono`} />
      </label>
      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Tipo de unidad
        <select disabled={locked} value={type} onChange={(e) => setType(e.target.value)} className={input}>
          {PARTNER_VEHICLE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
      </label>
      {type === 'water_truck' && (
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Capacidad de la pipa (m³)
          <input required disabled={locked} type="number" min={0.5} step="0.5" value={cap} onChange={(e) => setCap(e.target.value)} className={input} />
        </label>
      )}
      {!locked && <div className="sm:col-span-2"><button className={btn}>Guardar</button></div>}
    </form>
  );
}

function ServicesForm({ app, locked, onSave }: { app: PartnerApplication; locked: boolean; onSave: SaveFn }) {
  const [sel, setSel] = useState<string[]>(app.services);
  const toggle = (v: string) => setSel((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  return (
    <div>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Solo te llegan solicitudes de los servicios que marques.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PARTNER_SERVICES.map((s) => (
          <label key={s.value} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" disabled={locked} checked={sel.includes(s.value)} onChange={() => toggle(s.value)} /> {s.label}
          </label>
        ))}
      </div>
      {!locked && (
        <button className={`${btn} mt-4`} disabled={sel.length === 0} onClick={() => onSave('partner_save_services', { p_service_types: sel }, 'Servicios guardados.')}>
          Guardar
        </button>
      )}
    </div>
  );
}

function BankForm({ app, locked, onSave }: { app: PartnerApplication; locked: boolean; onSave: SaveFn }) {
  const [bank, setBank] = useState(app.bank?.bank_name ?? '');
  const [type, setType] = useState<'ahorro' | 'corriente'>(app.bank?.account_type ?? 'ahorro');
  const [num, setNum] = useState('');
  const [holder, setHolder] = useState(app.bank?.holder ?? app.identity.full_name ?? '');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await onSave('partner_save_bank', { p_bank_name: bank, p_account_type: type, p_account_number: num, p_holder: holder }, 'Cuenta bancaria guardada.');
    if (ok) setNum('');
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {app.bank && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400 sm:col-span-2">
          Guardada: {app.bank.bank_name} · cuenta de {app.bank.account_type} terminada en <strong>{app.bank.account_last4}</strong> · {app.bank.holder}
        </p>
      )}
      {!locked && (
        <>
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Banco
            <input required list="bancos-sv" value={bank} onChange={(e) => setBank(e.target.value)} className={input} />
            <datalist id="bancos-sv">{BANKS.map((b) => <option key={b} value={b} />)}</datalist>
          </label>
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Tipo de cuenta
            <select value={type} onChange={(e) => setType(e.target.value as 'ahorro' | 'corriente')} className={input}>
              <option value="ahorro">Ahorro</option>
              <option value="corriente">Corriente</option>
            </select>
          </label>
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Número de cuenta
            <input required inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value)} placeholder={app.bank ? `•••• ${app.bank.account_last4} (escríbelo para cambiarlo)` : ''} className={`${input} font-mono`} />
          </label>
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Titular de la cuenta
            <input required value={holder} onChange={(e) => setHolder(e.target.value)} className={input} />
          </label>
          <p className="text-xs text-zinc-500 sm:col-span-2">La cuenta debe estar a tu nombre. Solo tú y el equipo de pagos de Budi ven el número completo.</p>
          <div className="sm:col-span-2"><button className={btn}>Guardar</button></div>
        </>
      )}
    </form>
  );
}

function DocStatus({ doc }: { doc?: AppDocument }) {
  if (!doc) return <span className="text-xs text-zinc-500">Sin subir</span>;
  if (doc.expired) return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><AlertTriangle className="h-3.5 w-3.5" /> Vencido</span>;
  if (doc.review_status === 'rejected') return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><XCircle className="h-3.5 w-3.5" /> Por corregir</span>;
  if (doc.review_status === 'approved') {
    return doc.expiring_soon
      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> Aprobado · por vencer</span>
      : <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600"><CheckCircle2 className="h-3.5 w-3.5" /> Aprobado</span>;
  }
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><Clock className="h-3.5 w-3.5" /> Subido · por revisar</span>;
}

function Documents({ app, uid, onUploaded }: { app: PartnerApplication; uid: string; onUploaded: () => Promise<void> }) {
  const [expiry, setExpiry] = useState<Partial<Record<DocType, string>>>({});
  const [busy, setBusy] = useState<DocType | null>(null);
  const toast = useToast();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(new Date());

  const upload = async (type: DocType, bucket: string, needsExpiry: boolean, file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Sube una foto (JPG o PNG).');
    if (file.size > 8 * 1024 * 1024) return toast.error('La foto pesa más de 8 MB.');
    const exp = expiry[type] ?? app.documents[type]?.expires_on ?? '';
    if (needsExpiry && (!exp || exp <= today)) return toast.error('Primero indica la fecha de vencimiento (tiene que estar vigente).');
    setBusy(type);
    const supabase = createClient();
    const path = uploadPath(uid, type, file.name);
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setBusy(null);
      return toast.error(`No se pudo subir la foto: ${upErr.message}`);
    }
    const { error } = await supabase.rpc('upsert_operator_document', {
      p_doc_type: type,
      p_bucket: bucket,
      p_path: path,
      ...(needsExpiry ? { p_expires_on: exp } : {}),
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`${DOC_LABEL[type]}: subido.`);
    await onUploaded();
  };

  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {DOCS.map((d) => {
        const doc = app.documents[d.type];
        const allowed = canUpload(app, doc);
        return (
          <li key={d.type} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-white">{d.label}</p>
              <p className="text-xs text-zinc-500">{d.hint}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <DocStatus doc={doc} />
                {doc?.expires_on && <span className="text-xs text-zinc-500">vence el {formatDate(doc.expires_on)}</span>}
              </div>
              {doc?.review_status === 'rejected' && doc.review_note && (
                <p className="mt-1 text-xs text-red-600">Corrección: {doc.review_note}</p>
              )}
            </div>
            {allowed && (
              <div className="flex flex-wrap items-center gap-2">
                {d.expires && (
                  <label className="text-xs text-zinc-600 dark:text-zinc-400">
                    Vence
                    <input
                      type="date"
                      min={today}
                      value={expiry[d.type] ?? ''}
                      onChange={(e) => setExpiry((p) => ({ ...p, [d.type]: e.target.value }))}
                      className="ml-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </label>
                )}
                <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800 ${busy === d.type ? 'opacity-50' : ''}`}>
                  <FileUp className="h-3.5 w-3.5" />
                  {busy === d.type ? 'Subiendo…' : doc ? (app.can_edit ? 'Cambiar' : 'Subir renovación') : 'Subir foto'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={busy !== null}
                    onChange={(e) => {
                      upload(d.type, d.bucket, d.expires, e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SignupCard() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tel = normalizeSvPhone(phone);
    if (!tel) return setErr('Teléfono de El Salvador de 8 dígitos.');
    if (password.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.');
    setBusy(true);
    setErr(null);
    const { data, error } = await createClient().auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim(), phone: tel, role: 'OPERATOR', privacy_accepted: 'true' },
        emailRedirectTo: `${window.location.origin}/socios/registro`,
      },
    });
    setBusy(false);
    if (error) return setErr(error.message);
    if (data.session) window.location.reload();
    else setCheckEmail(true);
  };

  if (checkEmail) {
    return (
      <div className={`${card} mx-auto max-w-md text-center text-sm text-zinc-700 dark:text-zinc-300`}>
        Te enviamos un correo a <strong>{email}</strong>. Ábrelo para confirmar tu cuenta y vuelve aquí para completar tu registro.
      </div>
    );
  }

  return (
    <div className={`${card} mx-auto max-w-md`}>
      <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Crea tu cuenta de socio</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Después completas tus datos, tu unidad y tus documentos. Puedes guardar y seguir otro día.
      </p>
      <form onSubmit={submit} className="mt-5 space-y-3">
        {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>}
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Nombre completo
          <input required value={name} onChange={(e) => setName(e.target.value)} className={input} autoComplete="name" />
        </label>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Correo
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoComplete="email" />
        </label>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Teléfono
          <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="7012-3456" className={input} autoComplete="tel" />
        </label>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Contraseña
          <input required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={input} autoComplete="new-password" />
        </label>
        <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" required checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-1" />
          <span>
            Acepto el <Link href="/privacidad" className="underline">aviso de privacidad</Link>. Budi trata mis datos, documentos y mi
            ubicación mientras estoy en línea para operar como socio.
          </span>
        </label>
        <button className={`${btn} w-full`} disabled={busy || !privacy}>{busy ? 'Creando…' : 'Crear cuenta'}</button>
      </form>
      <p className="mt-4 text-center text-sm text-zinc-600 dark:text-zinc-400">
        ¿Ya tienes cuenta? <Link href="/login?redirect=/socios/registro" className="font-medium underline">Inicia sesión</Link>
      </p>
    </div>
  );
}

export default function PartnerRegistrationPage() {
  return (
    <FeedbackProvider>
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <Link href="/socios" className="flex items-center gap-2">
              <BudiLogo />
              <span className="font-heading text-lg font-bold text-zinc-900 dark:text-white">Registro de socio</span>
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">
          <Registration />
        </main>
      </div>
    </FeedbackProvider>
  );
}
