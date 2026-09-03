import { redirect } from 'next/navigation';
import { createClient } from '@/shared/lib/supabase/server';
import { FeedbackProvider } from '@/shared/components/FeedbackProvider';
import { InsurerShell } from '@/features/insurer/InsurerShell';

// B-17: portal de la aseguradora. Guard server-side: solo rol INSURER.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?redirect=/portal');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, insurer_id, insurers:insurer_id(name)')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'INSURER') redirect('/');

  const insurerName =
    (profile?.insurers as unknown as { name: string } | null)?.name ?? 'Aseguradora';

  return (
    <FeedbackProvider>
      <InsurerShell insurerName={insurerName} userName={profile?.full_name || ''}>
        {children}
      </InsurerShell>
    </FeedbackProvider>
  );
}
