import Link from 'next/link';
import { PauseCircle } from 'lucide-react';

/**
 * Lo que ve el admin al abrir por URL algo de una aseguradora o reaseguradora
 * con el interruptor apagado (migr. 00153). Se prende en /admin/app.
 */
export function InsurersPaused({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
      <PauseCircle className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
      <p className="font-medium text-zinc-900 dark:text-white">Aseguradoras en pausa</p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Todo lo de aseguradoras y reaseguradoras está oculto por ahora. Se activa desde App móvil.
      </p>
      <Link href={backHref} className="mt-4 inline-block text-sm font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
        {backLabel}
      </Link>
    </div>
  );
}
