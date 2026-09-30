'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy, FileCode2 } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { money } from '@/shared/lib/format';
import type { StatementDetail } from '@/features/statements/statement-types';
import { buildDte, missingFields, type DteType, type Emisor, type Receptor } from './dte';
import { WHAT_IS_BILLED, statementItems } from './statement-dte';

// LAN-09 (base): borrador del DTE de un estado de cuenta aprobado. Se arma el
// JSON con la estructura del MH para revisarlo con el contador; no se firma ni
// se transmite (falta el certificado y las credenciales del MH).

type Settings = {
  settings: { emisor: Partial<Emisor>; ambiente: '00' | '01'; cod_estable: string; cod_punto_venta: string; prices_include_iva: boolean };
  clients: { organization_id: string; dte_type: DteType; receptor: Partial<Receptor> }[];
};

export function DteDraftPanel({ d }: { d: StatementDetail }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ json: string; missing: string[]; tipo: DteType; total: number; items: number } | null>(null);

  const generate = async () => {
    const { data, error } = await createClient().rpc('admin_dte_settings');
    if (error) return toast.error(error.message);
    const s = data as unknown as Settings;
    const client = s.clients.find((c) => c.organization_id === d.organization.id);
    const tipo: DteType = client?.dte_type ?? (d.organization.type === 'MOPT' ? '01' : '03');
    const receptor = { nombre: d.organization.name, ...(client?.receptor ?? {}) } as Receptor;
    const items = statementItems(d);
    const dte = buildDte(s.settings.emisor as Emisor, receptor, items, {
      tipo, ambiente: s.settings.ambiente, codEstable: s.settings.cod_estable, codPuntoVenta: s.settings.cod_punto_venta,
      correlativo: 0, codigoGeneracion: crypto.randomUUID(), fecha: new Date(),
      preciosIncluyenIva: s.settings.prices_include_iva, condicionOperacion: 2,
    }) as { resumen: { totalPagar: number } };
    setDraft({
      json: JSON.stringify(dte, null, 2), missing: missingFields(tipo, s.settings.emisor, receptor), tipo,
      total: dte.resumen.totalPagar, items: items.length,
    });
    setOpen(true);
  };

  // Sin `draft!`: el React Compiler evalúa esas rutas como dependencias en el
  // render, cuando draft todavía es null.
  const copy = async () => {
    const json = draft?.json;
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      toast.success('JSON copiado.');
    } catch {
      toast.error('No se pudo copiar. Selecciona el texto a mano.');
    }
  };

  const download = () => {
    const json = draft?.json;
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `dte-borrador-${d.number ?? d.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (d.viewer !== 'budi' || !['approved', 'paid'].includes(d.status)) return null;

  return (
    <div className="mt-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-medium text-zinc-900 dark:text-white"><FileCode2 className="h-4 w-4" /> Factura electrónica (borrador)</p>
          <p className="text-xs text-zinc-500">{WHAT_IS_BILLED[d.organization.type]} Aún no se firma ni se envía a Hacienda.</p>
        </div>
        <button onClick={open ? () => setOpen(false) : generate} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {open ? 'Ocultar' : 'Generar borrador de DTE'}
        </button>
      </div>
      {open && draft && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {draft.tipo === '01' ? 'Factura (01)' : 'Comprobante de crédito fiscal (03)'} · {draft.items} ítem(s) · total a pagar {money(draft.total)}
          </p>
          {draft.missing.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-medium">Faltan datos fiscales para poder emitirlo:</p>
              <ul className="mt-1 list-disc pl-5">{draft.missing.map((m) => <li key={m}>{m}</li>)}</ul>
              <Link href="/admin/facturacion" className="mt-1 inline-block font-medium underline">Completar en Facturación</Link>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={download} className="rounded-lg bg-budi-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-budi-primary-700">Descargar JSON</button>
            <button onClick={copy} className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"><Copy className="h-4 w-4" /> Copiar</button>
          </div>
          <pre className="max-h-96 overflow-auto rounded-lg bg-zinc-50 p-3 text-xs text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">{draft.json}</pre>
        </div>
      )}
    </div>
  );
}
