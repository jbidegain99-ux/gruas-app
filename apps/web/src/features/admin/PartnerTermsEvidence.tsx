'use client';

import { useEffect, useState } from 'react';
import { FileSignature } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { formatDateTime } from '@/shared/lib/format';

// Evidencia de la aceptación del contrato del socio (migr. 00126, AGT-04):
// versión, fecha, IP y navegador.
type Acceptance = { version: string; title: string; accepted_at: string; ip: string | null; user_agent: string | null; current: boolean };

export function PartnerTermsEvidence({ operatorId }: { operatorId: string }) {
  const [rows, setRows] = useState<Acceptance[] | null>(null);

  useEffect(() => {
    let alive = true;
    createClient()
      .rpc('admin_partner_terms', { p_operator: operatorId })
      .then(({ data }) => alive && setRows((data as unknown as Acceptance[]) ?? []));
    return () => {
      alive = false;
    };
  }, [operatorId]);

  if (!rows) return null;
  const vigente = rows.some((r) => r.current);

  return (
    <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
      <p className="mb-1 flex items-center gap-2 font-medium text-zinc-900 dark:text-white">
        <FileSignature className="h-4 w-4 text-zinc-400" /> Contrato
        {!vigente && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">Falta aceptar la versión vigente</span>}
      </p>
      {rows.length === 0 ? (
        <p className="text-zinc-500">No ha aceptado ninguna versión.</p>
      ) : (
        <ul className="space-y-1 text-zinc-600 dark:text-zinc-400">
          {rows.map((r) => (
            <li key={r.version}>
              Versión <strong className="text-zinc-800 dark:text-zinc-200">{r.version}</strong>
              {r.current && ' (vigente)'} · {formatDateTime(r.accepted_at)} · IP {r.ip ?? 'no registrada'}
              {r.user_agent && <span className="block truncate text-xs text-zinc-400" title={r.user_agent}>{r.user_agent}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
