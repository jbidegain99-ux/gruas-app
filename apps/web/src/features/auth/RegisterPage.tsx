'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/shared/lib/supabase/client';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { authErrorMessage } from './recovery';

export default function RegisterPage() {

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Decreto 144: el aviso es requisito para usar la plataforma; el marketing es
  // opcional y va aparte. Ninguna de las dos arranca marcada (el consentimiento
  // premarcado no es "libre"). Ver docs/PROTECCION_DATOS.md §5.
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      setLoading(false);
      return;
    }

    if (!privacyAccepted) {
      setError('Debes aceptar el Aviso de privacidad para crear tu cuenta.');
      setLoading(false);
      return;
    }

    const supabase = createClient();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone,
          role: 'USER',
          // El trigger handle_new_user (migr. 00041) sella la fecha de aceptacion
          // y guarda el opt-in: la ley pide poder acreditar el consentimiento.
          privacy_accepted: 'true',
          marketing_opt_in: marketingOptIn,
        },
      },
    });

    if (error) {
      setError(authErrorMessage(error.message));
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-6 w-6 text-green-600 dark:text-green-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-white">
              Registro exitoso
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Te enviamos un correo de verificación a tu email.
              Revisa tu bandeja de entrada.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block rounded-lg bg-budi-primary-500 px-6 py-2 font-medium text-white hover:bg-budi-primary-600"
            >
              Ir a iniciar sesión
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <div className="rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-8 text-center">
            <Link href="/" className="inline-flex items-center gap-2">
              <BudiLogo />
              <span className="font-heading text-xl font-bold text-zinc-900 dark:text-white">
                Budi
              </span>
            </Link>
            <h1 className="mt-6 text-2xl font-bold text-zinc-900 dark:text-white">
              Crear cuenta
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Regístrate para solicitar servicios de asistencia
            </p>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="fullName"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Nombre completo
              </label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 placeholder-zinc-400 focus:border-budi-primary-500 focus:outline-none focus:ring-1 focus:ring-budi-primary-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
                placeholder="Juan Pérez"
              />
            </div>

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 placeholder-zinc-400 focus:border-budi-primary-500 focus:outline-none focus:ring-1 focus:ring-budi-primary-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
                placeholder="tu@email.com"
              />
            </div>

            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Teléfono
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 placeholder-zinc-400 focus:border-budi-primary-500 focus:outline-none focus:ring-1 focus:ring-budi-primary-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
                placeholder="+503 7777-8888"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 placeholder-zinc-400 focus:border-budi-primary-500 focus:outline-none focus:ring-1 focus:ring-budi-primary-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
                placeholder="********"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Confirmar contraseña
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 placeholder-zinc-400 focus:border-budi-primary-500 focus:outline-none focus:ring-1 focus:ring-budi-primary-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
                placeholder="********"
              />
            </div>

            <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
              <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                Para prestarte asistencia vial tratamos tu nombre, teléfono, correo,
                datos de tu vehículo y <strong>tu ubicación durante el servicio</strong>.
                Compartimos tu nombre, teléfono y ubicación de recogida{' '}
                <strong>únicamente con el socio operador que te atiende</strong>.
              </p>

              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={(e) => setPrivacyAccepted(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-300 text-budi-primary-500 focus:ring-budi-primary-500"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  He leído y acepto el{' '}
                  <Link href="/privacidad" target="_blank" className="font-medium text-budi-primary-500 hover:underline">
                    Aviso de privacidad
                  </Link>
                  .
                </span>
              </label>

              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={marketingOptIn}
                  onChange={(e) => setMarketingOptIn(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-300 text-budi-primary-500 focus:ring-budi-primary-500"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  Quiero recibir promociones y novedades de Budi.{' '}
                  <span className="text-zinc-500">(opcional)</span>
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || !privacyAccepted}
              className="w-full rounded-lg bg-budi-primary-500 px-4 py-2 font-medium text-white hover:bg-budi-primary-600 focus:outline-none focus:ring-2 focus:ring-budi-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-zinc-900"
            >
              {loading ? 'Registrando...' : 'Crear cuenta'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
            ¿Ya tienes cuenta?{' '}
            <Link
              href="/login"
              className="font-medium text-budi-primary-500 hover:text-budi-primary-400"
            >
              Inicia sesión
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
