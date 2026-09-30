'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { LogoutButton } from '@/shared/components/LogoutButton';
import { AdminNav } from '@/features/admin/AdminNav';
import { AdminRoleProvider, type PanelRole } from '@/features/admin/AdminRoleContext';
import { OpsAlertsBar } from '@/features/admin/OpsAlertsBar';
import { PlatformFeaturesProvider } from '@/shared/lib/use-platform-features';
import type { PlatformFeatures } from '@/shared/lib/platform-features';

/**
 * Shell responsive del panel admin. En pantallas grandes (lg+) la barra lateral
 * es fija; en móvil se oculta fuera de pantalla y se abre con el botón de menú.
 * Antes el layout usaba una barra fija de 256px con `ml-64` en el contenido,
 * lo que dejaba el admin inutilizable en móvil (contenido tapado por la barra).
 */
export function AdminShell({
  userName,
  role,
  features,
  children,
}: {
  userName: string;
  role: PanelRole;
  features: PlatformFeatures;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <AdminRoleProvider role={role}>
    <PlatformFeaturesProvider value={features}>
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Barra superior (solo móvil) */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900 lg:hidden print:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menú"
          className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" className="flex items-center gap-2">
          <BudiLogo />
          <span className="font-heading text-lg font-bold text-zinc-900 dark:text-white">
            Budi Admin
          </span>
        </Link>
      </header>

      {/* Fondo oscuro al abrir el drawer en móvil */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Barra lateral */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 transform print:hidden border-r border-zinc-200 bg-white transition-transform duration-200 dark:border-zinc-800 dark:bg-zinc-900 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-zinc-200 px-6 dark:border-zinc-800">
          <Link href="/" className="flex items-center gap-2">
            <BudiLogo />
            <span className="font-heading text-lg font-bold text-zinc-900 dark:text-white">
              Budi Admin
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Al tocar un enlace del menú, el click burbujea aquí y cierra el drawer
            en móvil (en lg+ el drawer siempre está visible, así que da igual). */}
        {/* Con muchas rutas el menú no entra en pantallas bajas: se desplaza
            solo, sin meterse debajo del pie con el usuario (~8.5rem). */}
        <div onClick={() => setOpen(false)} className="h-[calc(100vh-4rem-8.5rem)] overflow-y-auto">
          <AdminNav role={role} />
        </div>

        <div className="absolute bottom-0 left-0 right-0 border-t border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
              {userName.charAt(0).toUpperCase() || 'A'}
            </div>
            <div className="flex-1 truncate">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">
                {userName || 'Admin'}
              </p>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {role === 'SUPPORT' ? 'Soporte' : 'Administrador'}
              </p>
            </div>
          </div>
          <LogoutButton className="w-full justify-center" />
        </div>
      </aside>

      {/* Contenido */}
      <main className="p-4 sm:p-6 lg:ml-64 lg:p-8 print:ml-0 print:p-0">
        <OpsAlertsBar />
        {children}
      </main>
    </div>
    </PlatformFeaturesProvider>
    </AdminRoleProvider>
  );
}
