'use client';

import { usePathname } from 'next/navigation';
import { StatementList } from './StatementList';

// Estados de cuenta en el portal del cliente (MOPT o aseguradora, migr. 00123):
// Budi los emite; aquí se revisan, se observan casos y se aprueban.
export default function ClientStatementsPage() {
  const base = usePathname().startsWith('/mopt') ? '/mopt/estados' : '/portal/estados';
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Estados de cuenta</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          El cierre de cada mes que te emite Budi. Revisa los servicios; si algo no cuadra, observa el caso y queda fuera del
          total hasta que Budi responda. Aprueba el dueño o un administrador del portal.
        </p>
      </div>
      <StatementList basePath={base} />
    </div>
  );
}
