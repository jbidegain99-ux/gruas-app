'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/shared/lib/supabase/client';
import { formatDateTime } from '@/shared/lib/format';
import type { PartnerApplication } from './partner-application';

// Contrato del socio (migr. 00126, AGT-04). Se lee completo aquí y se acepta
// con una casilla; la base guarda fecha, versión, IP y navegador. Se muestra
// aunque el registro esté en revisión o aprobado: una versión nueva hay que
// aceptarla igual.

type Terms = { id: string; version: string; title: string; body: string };

export function TermsSection({
  app,
  onAccept,
}: {
  app: PartnerApplication;
  onAccept: (termsId: string) => Promise<boolean>;
}) {
  const [terms, setTerms] = useState<Terms | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    createClient()
      .rpc('current_terms', { p_kind: 'partner' })
      .then(({ data }) => setTerms(data as unknown as Terms | null));
  }, [app.terms?.id]);

  if (!app.terms || !terms) return <p className="text-sm text-zinc-500">Cargando el contrato…</p>;

  if (!app.terms_pending && app.terms.accepted_at) {
    return (
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Aceptaste la versión <strong>{app.terms.version}</strong> el {formatDateTime(app.terms.accepted_at)}.{' '}
        <a href="/socios/contrato" target="_blank" rel="noopener" className="text-budi-primary-600 underline dark:text-budi-primary-400">
          Volver a leerlo
        </a>
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-zinc-900 dark:text-white">
        {terms.title} <span className="font-normal text-zinc-500">· versión {terms.version}</span>
      </p>
      <div
        tabIndex={0}
        aria-label="Texto del contrato"
        className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200"
      >
        {terms.body}
      </div>
      <label className="flex items-start gap-2 text-sm text-zinc-800 dark:text-zinc-200">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4" />
        Leí el contrato y lo acepto. Entiendo que presto servicios como socio independiente, no como empleado de Budi.
      </label>
      <button
        disabled={!checked || busy}
        onClick={async () => {
          setBusy(true);
          await onAccept(terms.id);
          setBusy(false);
        }}
        className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700 disabled:opacity-50"
      >
        Aceptar contrato
      </button>
    </div>
  );
}
