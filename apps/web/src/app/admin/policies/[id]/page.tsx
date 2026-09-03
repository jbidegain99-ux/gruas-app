import AdminPolicyDetailPage from '@/features/admin/AdminPolicyDetailPage';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminPolicyDetailPage policyId={id} />;
}
