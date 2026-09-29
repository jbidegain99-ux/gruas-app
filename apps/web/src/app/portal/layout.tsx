import { redirect } from 'next/navigation';
import { createClient } from '@/shared/lib/supabase/server';
import { FeedbackProvider } from '@/shared/components/FeedbackProvider';
import { InsurerShell } from '@/features/insurer/InsurerShell';
import { getMyOrganization } from '@/shared/lib/organization';

// B-17: portal de la aseguradora. Guard server-side: membresía activa en una
// organización de tipo aseguradora (00106, POR-01), no un rol de perfil.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?redirect=/portal');

  const [{ data: profile }, org] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).single(),
    getMyOrganization(supabase),
  ]);

  if (org?.type !== 'INSURER') redirect('/');

  const insurerName = org.name;

  return (
    <FeedbackProvider>
      <InsurerShell insurerName={insurerName} userName={profile?.full_name || ''}>
        {children}
      </InsurerShell>
    </FeedbackProvider>
  );
}
