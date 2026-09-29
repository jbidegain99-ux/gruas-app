import MoptReportPage from '@/features/mopt/MoptReportPage';

export default async function Page({ params }: { params: Promise<{ mes: string }> }) {
  const { mes } = await params;
  return <MoptReportPage month={mes} />;
}
