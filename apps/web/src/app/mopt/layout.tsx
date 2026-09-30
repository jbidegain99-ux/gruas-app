import { redirect } from 'next/navigation';
import { createClient } from '@/shared/lib/supabase/server';
import { FeedbackProvider } from '@/shared/components/FeedbackProvider';
import { MoptShell } from '@/features/mopt/MoptShell';
import { getMyOrganization } from '@/shared/lib/organization';

// Portal del programa MOPT (migr. 00097-00099). Guard server-side: membresía
// activa en una organización MOPT (00106, POR-01) con un programa real detrás
// (auth_mopt_id). El proxy ya filtra; esto cubre además una organización sin
// programa, que vería un portal vacío.
export default async function MoptLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?redirect=/mopt');

  const [{ data: profile }, { data: programId }, org] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).single(),
    supabase.rpc('auth_mopt_id'),
    getMyOrganization(supabase),
  ]);

  if (org?.type !== 'MOPT' || !programId) redirect('/');

  const { data: overview } = await supabase.rpc('mopt_overview');
  const programName = (overview as { program_name?: string } | null)?.program_name ?? 'Programa MOPT';

  return (
    <FeedbackProvider>
      <MoptShell programName={programName} userName={profile?.full_name || ''} memberRole={org.member_role}>
        {children}
      </MoptShell>
    </FeedbackProvider>
  );
}
