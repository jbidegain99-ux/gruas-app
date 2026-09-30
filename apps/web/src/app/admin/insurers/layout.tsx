import { requireFeature } from '@/shared/lib/require-feature';

// Aseguradoras en pausa (migr. 00153): con el interruptor apagado, esta sección
// (y sus detalles) vuelve al dashboard. Prenderlo en /admin/app la restaura.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireFeature('insurers', '/admin');
  return children;
}
