import { notFound } from 'next/navigation';
import AdminAccount360Page from '@/features/admin/AdminAccount360Page';
import { isAccountKind } from '@/features/admin/account-360';

// En Next 16 `params` es una promesa; se resuelve aquí para que el feature
// reciba valores planos.
export default async function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!isAccountKind(kind)) notFound();
  return <AdminAccount360Page kind={kind} accountId={id} />;
}
