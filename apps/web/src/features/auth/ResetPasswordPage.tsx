'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/shared/lib/supabase/client';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { authErrorMessage, readRecoveryLink } from './recovery';

// Recuperar la contraseña (Usuarios y socios piden desde la app; el personal,
// desde el login web). Dos pasos en la misma página:
//   1. sin enlace: pide el correo y manda el enlace a /recuperar;
//   2. con el enlace del correo: pide la contraseña nueva.
// Antes el enlace caía en la página de inicio y no había dónde escribirla.

type Paso = 'cargando' | 'pedir' | 'enviado' | 'nueva' | 'lista' | 'vencido';

const input =
  'mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 placeholder-zinc-400 focus:border-budi-primary-500 focus:outline-none focus:ring-1 focus:ring-budi-primary-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500';
const boton =
  'w-full rounded-lg bg-budi-primary-500 px-4 py-2 font-medium text-white hover:bg-budi-primary-600 focus:outline-none focus:ring-2 focus:ring-budi-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-zinc-900';

/** El mínimo del servidor de Auth (minimum_password_length). */
const MIN_PASSWORD = 6;

export default function ResetPasswordPage() {
  const [paso, setPaso] = useState<Paso>('cargando');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El enlace se lee una sola vez (en desarrollo React corre el efecto dos).
  const leido = useRef(false);
  useEffect(() => {
    if (leido.current) return;
    leido.current = true;
    const supabase = createClient();
    const link = readRecoveryLink(window.location.href);
    // Se borra el token de la barra de direcciones apenas se lee.
    if (link.kind !== 'none') window.history.replaceState(null, '', '/recuperar');

    (async () => {
      if (link.kind === 'error') return setPaso('vencido');
      if (link.kind === 'tokens') {
        const { error: e } = await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
        return setPaso(e ? 'vencido' : 'nueva');
      }
      if (link.kind === 'code') {
        // El cliente del navegador puede canjear el código solo al cargar
        // (detectSessionInUrl): si el canje propio falla pero ya hay sesión,
        // el enlace sirvió.
        const { error: e } = await supabase.auth.exchangeCodeForSession(link.code);
        if (!e) return setPaso('nueva');
        const { data } = await supabase.auth.getSession();
        return setPaso(data.session ? 'nueva' : 'vencido');
      }
      setPaso('pedir');
    })();
  }, []);

  const pedir = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/recuperar`,
    });
    setBusy(false);
    // No se dice si el correo existe: el mismo mensaje en los dos casos.
    if (err && !/rate limit|security purposes/i.test(err.message)) return setError(authErrorMessage(err.message));
    if (err) return setError('Espera un minuto antes de pedir otro enlace.');
    setPaso('enviado');
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
    if (password !== confirm) return setError('Las contraseñas no coinciden.');
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setBusy(false);
      return setError(authErrorMessage(err.message));
    }
    // La sesión del enlace no se deja abierta en este navegador.
    await supabase.auth.signOut();
    setBusy(false);
    setPaso('lista');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <BudiLogo />
            <span className="font-heading text-xl font-bold text-zinc-900 dark:text-white">Budi</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-zinc-900 dark:text-white">
            {paso === 'nueva' ? 'Elige tu contraseña nueva' : 'Recuperar contraseña'}
          </h1>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">{error}</div>
        )}

        {paso === 'cargando' && (
          <div className="flex justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-budi-primary-500 border-t-transparent" />
          </div>
        )}

        {paso === 'pedir' && (
          <form onSubmit={pedir} className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Escribe el correo de tu cuenta y te mandamos un enlace para elegir una contraseña nueva.
            </p>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} placeholder="tu@email.com" autoComplete="email" />
            </div>
            <button type="submit" disabled={busy} className={boton}>{busy ? 'Enviando…' : 'Enviarme el enlace'}</button>
          </form>
        )}

        {paso === 'enviado' && (
          <p className="text-center text-sm text-zinc-700 dark:text-zinc-300">
            Si existe una cuenta con <strong>{email}</strong>, te enviamos un enlace para elegir tu contraseña nueva.
            Revisa también la carpeta de correo no deseado.
          </p>
        )}

        {paso === 'nueva' && (
          <form onSubmit={guardar} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Contraseña nueva</label>
              <input id="password" type="password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} className={input} autoComplete="new-password" />
            </div>
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Repítela</label>
              <input id="confirm" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} autoComplete="new-password" />
            </div>
            <button type="submit" disabled={busy} className={boton}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
          </form>
        )}

        {paso === 'lista' && (
          <div className="space-y-4 text-center text-sm text-zinc-700 dark:text-zinc-300">
            <p>Listo, tu contraseña quedó cambiada. Ya puedes entrar con ella en la app de Budi o aquí.</p>
            <Link href="/login" className="font-medium text-budi-primary-500 hover:text-budi-primary-400">Iniciar sesión</Link>
          </div>
        )}

        {paso === 'vencido' && (
          <div className="space-y-4 text-center text-sm text-zinc-700 dark:text-zinc-300">
            <p>El enlace venció o ya se usó. Pide uno nuevo: los enlaces sirven una sola vez y por poco tiempo.</p>
            <button type="button" className={boton} onClick={() => { setError(null); setPaso('pedir'); }}>Pedir otro enlace</button>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/login" className="font-medium text-budi-primary-500 hover:text-budi-primary-400">Volver a iniciar sesión</Link>
        </p>
      </div>
    </div>
  );
}
