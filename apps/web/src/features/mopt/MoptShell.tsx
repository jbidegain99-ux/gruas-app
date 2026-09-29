'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { LogoutButton } from '@/shared/components/LogoutButton';

const TABS = [
  { href: '/mopt', label: 'Resumen' },
  // Backlog MOPT-01 y MOPT-02 (00107).
  { href: '/mopt/cumplimiento', label: 'Cumplimiento' },
  { href: '/mopt/km', label: 'Km por grúa' },
  { href: '/mopt/servicios', label: 'Servicios' },
  { href: '/mopt/mapa', label: 'Mapa' },
  { href: '/mopt/operadores', label: 'Socios operadores' },
  { href: '/mopt/pagos', label: 'Pagos' },
  // MOPT-03/04 (00123): el cierre de cada mes, con observaciones por caso.
  { href: '/mopt/estados', label: 'Estados de cuenta' },
  // POR-02 (00113): invitar al equipo, roles y bitácora de accesos.
  { href: '/mopt/equipo', label: 'Equipo' },
];

// Marco del portal MOPT. A diferencia del de aseguradoras, el MOPT sí opera:
// paga a sus operadores, así que lleva navegación.
export function MoptShell({
  programName,
  userName,
  children,
}: {
  programName: string;
  userName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 print:bg-white">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 print:hidden">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/mopt" className="flex items-center gap-2">
            <BudiLogo />
            <span className="font-heading text-base font-bold text-zinc-900 dark:text-white">Portal MOPT</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-zinc-900 dark:text-white">{programName}</p>
              {userName && <p className="text-xs text-zinc-500">{userName}</p>}
            </div>
            <LogoutButton />
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4" aria-label="Secciones del portal">
          {TABS.map(({ href, label }) => {
            const active = href === '/mopt' ? pathname === '/mopt' : pathname.startsWith(href);
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

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}
