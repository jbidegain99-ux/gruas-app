import AdminOnboardingDetailPage from '@/features/admin/AdminOnboardingDetailPage';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminOnboardingDetailPage organizationId={id} />;
}
