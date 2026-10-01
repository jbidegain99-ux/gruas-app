import Link from 'next/link';
import { lastSeen } from './mopt-fleet';

type StaleRow = { operator_id: string; full_name: string | null; phone: string | null; updated_at: string | null; active_request_id: string | null; active_folio?: string | null };

/** Socios con un servicio abierto que dejaron de mandar GPS (00155). */
export function StaleAlert({ rows, now }: { rows: StaleRow[]; now: number }) {
  return (
    <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <p className="font-semibold">
        {rows.length === 1 ? 'Un socio con servicio en curso está sin señal' : `${rows.length} socios con servicio en curso están sin señal`}
      </p>
      <ul className="mt-2 space-y-1">
        {rows.map((r) => (
          <li key={r.operator_id}>
            {r.full_name || 'Socio operador'} · visto {lastSeen(r.updated_at, now)}
            {r.phone && (
              <>
                {' · '}
                <a href={`tel:${r.phone.replace(/[^+\d]/g, '')}`} className="font-medium underline">
                  {r.phone}
                </a>
              </>
            )}
            {r.active_request_id && (
              <>
                {' · '}
                <Link href={`/mopt/servicios/${r.active_request_id}`} className="font-medium underline">
                  {r.active_folio ?? 'ver servicio'}
                </Link>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
