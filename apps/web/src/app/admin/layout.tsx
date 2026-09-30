import { redirect } from 'next/navigation';
import { createClient } from '@/shared/lib/supabase/server';
import { FeedbackProvider } from '@/shared/components/FeedbackProvider';
import { AdminShell } from '@/features/admin/AdminShell';
import { ADMIN_PANEL_ROLES } from '@/shared/lib/admin-routes';
import { getPlatformFeatures } from '@/shared/lib/platform-features';

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

  // Qué página puede abrir cada rol lo resuelve el proxy con admin-routes.ts;
  // acá solo se exige ser personal del panel.
  if (!profile?.role || !ADMIN_PANEL_ROLES.includes(profile.role)) {
    redirect('/');
  }

  // Interruptores (00153): el menú y las pantallas ocultan lo que está apagado.
  const features = await getPlatformFeatures(supabase);

  return (
    <FeedbackProvider>
      <AdminShell userName={profile.full_name || 'Admin'} role={profile.role} features={features}>
        {children}
      </AdminShell>
    </FeedbackProvider>
  );
}
