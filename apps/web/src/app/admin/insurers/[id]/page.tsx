import AdminInsurerDetailPage from '@/features/admin/AdminInsurerDetailPage';

// En Next 16 `params` es una promesa; se resuelve aquí para que el feature siga
// recibiendo un id plano y no tenga que saber nada del routing.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminInsurerDetailPage insurerId={id} />;
}
