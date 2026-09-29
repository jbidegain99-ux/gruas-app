'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { LogoutButton } from '@/shared/components/LogoutButton';

// B-17: marco del portal de la aseguradora. La aseguradora consulta y, desde la
// 00123 (ASE-03), revisa y aprueba sus estados de cuenta.
const TABS = [
  { href: '/portal', label: 'Casos' },
  // ASE-02 (00127): planes, pólizas y padrón.
  { href: '/portal/polizas', label: 'Pólizas' },
  { href: '/portal/estados', label: 'Estados de cuenta' },
  // POR-02 (00113): el equipo del portal.
  { href: '/portal/equipo', label: 'Equipo' },
  // ASE-04 (00129): claves de API y webhooks.
  { href: '/portal/integraciones', label: 'Integraciones' },
];

export function InsurerShell({
  insurerName,
  userName,
  children,
}: {
  insurerName: string;
  userName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 print:bg-white">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 print:hidden">
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
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4" aria-label="Secciones del portal">
          {TABS.map(({ href, label }) => {
            // "/portal/BUDI-…" (detalle de un caso) sigue siendo "Casos".
            const active =
              href === '/portal'
                ? !TABS.some((t) => t.href !== '/portal' && pathname.startsWith(t.href))
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? 'border-budi-primary-500 text-budi-primary-700 dark:text-budi-primary-300'
                    : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
