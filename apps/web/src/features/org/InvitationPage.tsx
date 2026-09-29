'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { PORTAL_BY_ORG_TYPE, securityUrl, type OrganizationType } from '@/shared/lib/organization';
import { MEMBER_ROLE_LABELS, type MemberRole } from './org-links';

// Aceptar una invitación al equipo de un portal (migr. 00113, POR-02).
// El enlace del correo inicia sesión (flujo implicit: los tokens llegan en el
// #hash, así funciona en cualquier dispositivo) y trae el token de la
// invitación. La base solo la acepta si la sesión es del correo invitado.

type Accepted = { organization: string; type: OrganizationType; role: MemberRole; mfa_required: boolean };

const inputClass =
  'mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 focus:border-budi-primary-500 focus:outline-none focus:ring-1 focus:ring-budi-primary-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

function InvitationFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'loading' | 'needs-login' | 'accepted' | 'error'>('loading');
  const [accepted, setAccepted] = useState<Accepted | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const run = async () => {
      // Enlace del correo: la sesión viene en el hash (#access_token=...).
      if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
        const h = new URLSearchParams(window.location.hash.slice(1));
        const access_token = h.get('access_token');
        const refresh_token = h.get('refresh_token');
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
        }
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }

      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setState('needs-login');
        return;
      }
      setEmail(data.user.email ?? null);
      if (!token) {
        setMessage('El enlace no trae una invitación.');
        setState('error');
        return;
      }
      const { data: res, error } = await supabase.rpc('accept_org_invitation', { p_token: token });
      if (error) {
        setMessage(error.message);
        setState('error');
        return;
      }
      setAccepted(res as unknown as Accepted);
      setState('accepted');
    };
    run();
  }, [token]);

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPassword(true);
    const { error } = await createClient().auth.updateUser({ password });
    setSavingPassword(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setPasswordSaved(true);
    setMessage(null);
  };

  const portal = accepted ? PORTAL_BY_ORG_TYPE[accepted.type] ?? '/' : '/';
  const continueTo = accepted?.mfa_required ? securityUrl(portal) : portal;
  const back = `/invitacion?token=${encodeURIComponent(token)}`;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-6 text-center">
        <Link href="/" className="inline-flex items-center gap-2">
          <BudiLogo />
          <span className="font-heading text-xl font-bold text-zinc-900 dark:text-white">Budi</span>
        </Link>
        <div className="mx-auto mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-budi-primary-50 dark:bg-budi-primary-900/40">
          <MailCheck className="h-6 w-6 text-budi-primary-600 dark:text-budi-primary-300" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-zinc-900 dark:text-white">Invitación al portal</h1>
      </div>

      {state === 'loading' && (
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-budi-primary-500 border-t-transparent" />
        </div>
      )}

      {state === 'needs-login' && (
        <div className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
          <p>
            Para aceptar, entra con el <strong>mismo correo</strong> al que te llegó la invitación. Lo más fácil es abrir
            el enlace directamente desde ese correo.
          </p>
          <p>Si ya tienes una cuenta de Budi con ese correo, también puedes iniciar sesión:</p>
          <Link
            href={`/login?redirect=${encodeURIComponent(back)}`}
            className="block w-full rounded-lg bg-budi-primary-500 px-4 py-2 text-center font-medium text-white hover:bg-budi-primary-600"
          >
            Iniciar sesión
          </Link>
        </div>
      )}

      {state === 'error' && (
        <div className="space-y-4">
          <p className="rounded-lg bg-red-50 p-4 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">{message}</p>
          {email && <p className="text-xs text-zinc-500">Sesión actual: {email}</p>}
        </div>
      )}

      {state === 'accepted' && accepted && (
        <div className="space-y-5 text-sm text-zinc-700 dark:text-zinc-300">
          <p className="rounded-lg bg-green-50 p-4 text-green-800 dark:bg-green-950 dark:text-green-200">
            Ya eres parte del equipo de <strong>{accepted.organization}</strong> como{' '}
            <strong>{MEMBER_ROLE_LABELS[accepted.role].toLowerCase()}</strong>.
          </p>

          {!passwordSaved ? (
            <form onSubmit={savePassword} className="space-y-2">
              <p>¿Entraste con el enlace del correo? Crea una contraseña para volver a entrar cuando quieras (opcional):</p>
              <input
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className={inputClass}
                aria-label="Nueva contraseña"
              />
              <button
                type="submit"
                disabled={savingPassword || password.length < 8}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {savingPassword ? 'Guardando…' : 'Guardar contraseña'}
              </button>
              {message && <p className="text-xs text-red-600">{message}</p>}
            </form>
          ) : (
            <p className="text-xs text-green-700 dark:text-green-300">Contraseña guardada.</p>
          )}

          {accepted.mfa_required && (
            <p className="text-xs text-zinc-500">
              Como {MEMBER_ROLE_LABELS[accepted.role].toLowerCase()}, el siguiente paso es activar la verificación en dos pasos.
            </p>
          )}
          <button
            onClick={() => {
              router.replace(continueTo);
              router.refresh();
            }}
            className="w-full rounded-lg bg-budi-primary-500 px-4 py-2 font-medium text-white hover:bg-budi-primary-600"
          >
            Entrar al portal
          </button>
        </div>
      )}
    </div>
  );
}

export default function InvitationPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <Suspense fallback={null}>
          <InvitationFlow />
        </Suspense>
      </div>
    </div>
  );
}
