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
  ShieldCheck,
  ShieldPlus,
  History,
  Landmark,
  Scale,
  Percent,
  TrendingUp,
  UserPlus,
  Smartphone,
  FileSpreadsheet,
  Banknote,
  ClipboardCheck,
  Network,
  HandCoins,
  ReceiptText,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';
import { adminNavFor } from '@/shared/lib/admin-routes';
import type { PanelRole } from './AdminRoleContext';

// Las rutas y quién entra viven en shared/lib/admin-routes.ts (las usa también
// el guard del proxy). Acá solo se les pone ícono.
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  business: TrendingUp,
  requests: Truck,
  fleet: Map,
  finance: Wallet,
  accounts: Scale,
  insurers: ShieldPlus,
  providers: Building2,
  mopt: Landmark,
  services: Wrench,
  pricing: DollarSign,
  rates: Percent,
  users: Users,
  verifications: ShieldCheck,
  leads: UserPlus,
  ratings: Star,
  audit: History,
  app: Smartphone,
  statements: FileSpreadsheet,
  payouts: Banknote,
  onboarding: ClipboardCheck,
  reinsurers: Network,
  collections: HandCoins,
  billing: ReceiptText,
};

export function AdminNav({ role }: { role: PanelRole }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-1 p-4">
      {adminNavFor(role).map(({ href, label, icon }) => {
        const Icon = ICONS[icon] ?? LayoutDashboard;
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
