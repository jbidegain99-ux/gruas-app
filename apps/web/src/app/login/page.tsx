'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { BudiLogo } from '@/components/BudiLogo';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Get user profile to determine redirect
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profile?.role === 'ADMIN') {
        router.push('/admin');
      } else if (profile?.role === 'MOP') {
        router.push('/mop');
      } else if (profile?.role === 'USER' || profile?.role === 'OPERATOR') {
        // Redirect mobile-first roles to info page
        router.push('/mobile-info');
      } else {
        router.push(redirect);
      }
    }

    router.refresh();
  };

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-8 text-center">
        <Link href="/" className="inline-flex items-center gap-2">
          <BudiLogo />
          <span className="font-heading text-xl font-bold text-zinc-900 dark:text-white">
            Budi
          </span>
        </Link>
        <h1 className="mt-6 text-2xl font-bold text-zinc-900 dark:text-white">
          Iniciar Sesion
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Ingresa tus credenciales para acceder
        </p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

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
            htmlFor="password"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Contrasena
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 placeholder-zinc-400 focus:border-budi-primary-500 focus:outline-none focus:ring-1 focus:ring-budi-primary-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
            placeholder="********"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-budi-primary-500 px-4 py-2 font-medium text-white hover:bg-budi-primary-600 focus:outline-none focus:ring-2 focus:ring-budi-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-zinc-900"
        >
          {loading ? 'Iniciando sesion...' : 'Iniciar Sesion'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
        No tienes cuenta?{' '}
        <Link
          href="/register"
          className="font-medium text-budi-primary-500 hover:text-budi-primary-400"
        >
          Registrate
        </Link>
      </p>
    </div>
  );
}

function LoadingForm() {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-budi-primary-500 border-t-transparent" />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <Suspense fallback={<LoadingForm />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
