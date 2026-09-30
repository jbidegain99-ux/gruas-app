import { notFound } from 'next/navigation';
import AdminAccount360Page from '@/features/admin/AdminAccount360Page';
import { isAccountKind } from '@/features/admin/account-360';
import { requireFeature } from '@/shared/lib/require-feature';

// En Next 16 `params` es una promesa; se resuelve aquí para que el feature
// reciba valores planos.
export default async function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!isAccountKind(kind)) notFound();
  // Aseguradoras en pausa (00153): su ficha vuelve a Cuentas.
  if (kind === 'insurer') await requireFeature('insurers', '/admin/cuentas');
  return <AdminAccount360Page kind={kind} accountId={id} />;
}
