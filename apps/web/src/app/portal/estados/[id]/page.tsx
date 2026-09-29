import { StatementDetailView } from '@/features/statements/StatementDetailView';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StatementDetailView id={id} backHref="/portal/estados" />;
}
