'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Truck,
  Building2,
  Wrench,
  DollarSign,
  Users,
  Star,
  Wallet,
  Map,
} from 'lucide-react';

const NAV_LINKS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/requests', label: 'Solicitudes', icon: Truck },
  { href: '/admin/fleet', label: 'Flota', icon: Map },
  { href: '/admin/finance', label: 'Finanzas', icon: Wallet },
  { href: '/admin/providers', label: 'Proveedores', icon: Building2 },
  { href: '/admin/services', label: 'Servicios', icon: Wrench },
  { href: '/admin/pricing', label: 'Precios', icon: DollarSign },
  { href: '/admin/users', label: 'Usuarios', icon: Users },
  { href: '/admin/ratings', label: 'Calificaciones', icon: Star },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-1 p-4">
      {NAV_LINKS.map(({ href, label, icon: Icon }) => {
        const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? 'bg-budi-primary-50 text-budi-primary-700 dark:bg-budi-primary-900/30 dark:text-budi-primary-300'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
            }`}
          >
            <Icon className={`h-5 w-5 ${active ? 'text-budi-primary-600 dark:text-budi-primary-400' : ''}`} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
