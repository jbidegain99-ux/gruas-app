'use client';

import { useEffect, useState } from 'react';
import { Clock, Download } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';

// B-14: la línea de tiempo del caso, tal como la devuelve get_case_timeline().
type TimelineRow = {
  at: string;
  event_type: string;
  label: string;
  actor_role: string | null;
  detail: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  USER: 'Usuario',
  OPERATOR: 'Socio operador',
  ADMIN: 'Administrador',
  SUPPORT: 'Soporte',
};

/**
 * Muestra el folio del caso y su línea de tiempo, y permite exportarla.
 *
 * El folio es la referencia pública del servicio (B-14); la timeline se arma en
 * la base a partir de request_events, ya traducida a español. Exportar baja un
 * JSON con el folio y los eventos — la base de lo que la aseguradora recibirá
 * por el portal (B-17).
 */
export function CaseTimeline({ folio }: { folio: string | null }) {
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // `loadedFolio` = el folio para el que ya hay datos. `loading` se DERIVA de
  // comparar con el folio pedido, así el effect no setea estado sincrónicamente
  // (lo que dispararía renders en cascada).
  const [loadedFolio, setLoadedFolio] = useState<string | null>(null);
  const loading = folio != null && folio !== loadedFolio;

  useEffect(() => {
    if (!folio) return;
    let alive = true;
    createClient()
      .rpc('get_case_timeline', { p_folio: folio })
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e) {
          setError('No se pudo cargar la línea de tiempo.');
          setRows([]);
        } else {
          setError(null);
          setRows((data as TimelineRow[]) ?? []);
        }
        setLoadedFolio(folio);
      });
    return () => {
      alive = false;
    };
  }, [folio]);

  if (!folio) return null;

  const showError = error && loadedFolio === folio;

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('es-SV', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  const exportar = () => {
    const doc = {
      folio,
      exportado_el: new Date().toISOString(),
      eventos: rows.map((r) => ({
        fecha: r.at,
        evento: r.label,
        actor: r.actor_role ? ROLE_LABEL[r.actor_role] ?? r.actor_role : null,
        detalle: r.detail,
      })),
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${folio}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-zinc-400" />
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">Línea de tiempo</p>
        </div>
        <button
          onClick={exportar}
          disabled={loading || rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-zinc-500">Cargando…</p>
      ) : showError ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-zinc-500">Sin eventos registrados.</p>
      ) : (
        <ol className="relative space-y-3 pl-4">
          {rows.map((r, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-4 top-1.5 h-2 w-2 rounded-full bg-budi-primary-400" aria-hidden="true" />
              {i < rows.length - 1 && (
                <span className="absolute -left-[11px] top-3 h-full w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden="true" />
              )}
              <p className="text-sm font-medium text-zinc-900 dark:text-white">{r.label}</p>
              <p className="text-xs text-zinc-500">
                {fmt(r.at)}
                {r.actor_role ? ` · ${ROLE_LABEL[r.actor_role] ?? r.actor_role}` : ''}
                {r.detail ? ` · ${r.detail}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
