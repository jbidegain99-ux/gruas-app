'use client';

import Link from 'next/link';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { LogoutButton } from '@/shared/components/LogoutButton';

// B-17: marco del portal de la aseguradora. Simple a propósito — un header y el
// contenido; la aseguradora consulta, no opera, así que no necesita navegación.
export function InsurerShell({
  insurerName,
  userName,
  children,
}: {
  insurerName: string;
  userName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/portal" className="flex items-center gap-2">
            <BudiLogo />
            <span className="font-heading text-base font-bold text-zinc-900 dark:text-white">
              Portal de aseguradoras
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-zinc-900 dark:text-white">{insurerName}</p>
              {userName && <p className="text-xs text-zinc-500">{userName}</p>}
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
