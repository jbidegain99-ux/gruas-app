import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/shared/lib/supabase/server';
import { LogoutButton } from '@/shared/components/LogoutButton';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { AdminNav } from '@/features/admin/AdminNav';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirect=/admin');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'ADMIN') {
    redirect('/');
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-64 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-16 items-center border-b border-zinc-200 px-6 dark:border-zinc-800">
          <Link href="/" className="flex items-center gap-2">
            <BudiLogo />
            <span className="font-heading text-lg font-bold text-zinc-900 dark:text-white">
              Budi Admin
            </span>
          </Link>
        </div>

        <AdminNav />

        <div className="absolute bottom-0 left-0 right-0 border-t border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
              {profile?.full_name?.charAt(0).toUpperCase() || 'A'}
            </div>
            <div className="flex-1 truncate">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">
                {profile?.full_name || 'Admin'}
              </p>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                Administrador
              </p>
            </div>
          </div>
          <LogoutButton className="w-full justify-center" />
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64 flex-1 p-8">{children}</main>
    </div>
  );
}
