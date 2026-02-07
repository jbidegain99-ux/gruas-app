'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Truck, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { LogoutButton } from '@/components/LogoutButton';
import { BudiLogo } from '@/components/BudiLogo';

type UserRole = 'USER' | 'OPERATOR' | 'MOP' | 'ADMIN';

export default function MobileInfoPage() {
  const [profile, setProfile] = useState<{ full_name: string | null; role: UserRole } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('full_name, role')
          .eq('id', user.id)
          .single();

        setProfile(data);
      }
      setLoading(false);
    };
    fetchProfile();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-budi-primary-500 border-t-transparent" />
      </div>
    );
  }

  const roleInfo = profile?.role === 'OPERATOR' ? {
    title: 'Operador',
    description: 'Como operador, puedes recibir y aceptar solicitudes de servicio desde la aplicacion movil.',
    icon: <Truck className="h-16 w-16" />,
  } : {
    title: 'Usuario',
    description: 'Como usuario, puedes solicitar servicios de asistencia desde la aplicacion movil.',
    icon: <User className="h-16 w-16" />,
  };

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <BudiLogo />
            <span className="font-heading text-xl font-bold text-zinc-900 dark:text-white">
              Budi
            </span>
          </Link>
          <LogoutButton />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="mx-auto max-w-lg text-center">
          <div className="mb-6 flex justify-center text-budi-primary-500">
            {roleInfo.icon}
          </div>

          <div className="mb-2 inline-flex rounded-full bg-budi-primary-100 px-3 py-1 text-sm font-medium text-budi-primary-800 dark:bg-budi-primary-900 dark:text-budi-primary-200">
            {roleInfo.title}
          </div>

          <h1 className="mt-4 text-3xl font-bold text-zinc-900 dark:text-white">
            Bienvenido, {profile?.full_name || 'Usuario'}
          </h1>

          <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
            {roleInfo.description}
          </p>

          <div className="mt-8 rounded-lg border border-zinc-200 bg-white p-6 text-left dark:border-zinc-700 dark:bg-zinc-800">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
              Descarga la App Movil
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Para acceder a todas las funciones de tu cuenta, descarga nuestra aplicacion movil:
            </p>

            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-700">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" className="h-6 w-6 text-zinc-700 dark:text-zinc-300">
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">iOS (App Store)</p>
                  <p className="text-xs text-zinc-500">Proximamente</p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-700">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" className="h-6 w-6 text-zinc-700 dark:text-zinc-300">
                    <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 01-.61-.92V2.734a1 1 0 01.609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.198l2.807 1.626a1 1 0 010 1.73l-2.808 1.626L15.206 12l2.492-2.491zM5.864 2.658L16.8 8.99l-2.302 2.302-8.634-8.634z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">Android (Play Store)</p>
                  <p className="text-xs text-zinc-500">Proximamente</p>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-amber-50 p-3 dark:bg-amber-950">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                <strong>Expo Go (Desarrollo):</strong> Si tienes acceso al servidor de desarrollo,
                escanea el codigo QR con la app Expo Go.
              </p>
            </div>
          </div>

          <div className="mt-6">
            <Link
              href="/"
              className="text-sm font-medium text-budi-primary-500 hover:text-budi-primary-400"
            >
              Volver al inicio
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
