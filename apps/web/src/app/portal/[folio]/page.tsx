import InsurerCaseDetailPage from '@/features/insurer/InsurerCaseDetailPage';

export default async function Page({ params }: { params: Promise<{ folio: string }> }) {
  const { folio } = await params;
  return <InsurerCaseDetailPage folio={decodeURIComponent(folio)} />;
}
