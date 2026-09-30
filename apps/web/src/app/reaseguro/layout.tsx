import { redirect } from 'next/navigation';
import { createClient } from '@/shared/lib/supabase/server';
import { FeedbackProvider } from '@/shared/components/FeedbackProvider';
import { ReinsurerShell } from '@/features/reinsurer/ReinsurerShell';
import { getMyOrganization } from '@/shared/lib/organization';
import { getPlatformFeatures } from '@/shared/lib/platform-features';

// REA-02 (00131): portal de la reaseguradora. Guard server-side: membresía activa
// en una organización de tipo reaseguradora. El proxy ya filtra.
export default async function ReinsurerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?redirect=/reaseguro');

  const [{ data: profile }, org, features] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).single(),
    getMyOrganization(supabase),
    getPlatformFeatures(supabase),
  ]);

  // Aseguradoras en pausa (migr. 00153): el portal no existe por ahora.
  if (!features.insurers) redirect('/');
  if (org?.type !== 'REINSURER') redirect('/');

  return (
    <FeedbackProvider>
      <ReinsurerShell orgName={org.name} userName={profile?.full_name || ''}>
        {children}
      </ReinsurerShell>
    </FeedbackProvider>
  );
}
