import InsurerPolicyMembersPage from '@/features/insurer/InsurerPolicyMembersPage';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InsurerPolicyMembersPage policyId={id} />;
}
