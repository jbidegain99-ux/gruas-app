'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/shared/lib/supabase/client';
import { useConfirm, useToast } from '@/shared/components/FeedbackProvider';
import { formatDateTime } from '@/shared/lib/format';

// REA-01 (00131): la aseguradora autoriza (o revoca) que su reaseguradora vea
// sus cifras agregadas. Solo el dueño del portal, con 2FA. Cada decisión queda
// registrada con quién, cuándo y desde dónde.

type Link = {
  id: string; reinsurer_name: string; valid_from: string; valid_to: string | null;
  consent_status: 'pending' | 'granted' | 'revoked'; consent_at: string | null;
  history: { action: 'granted' | 'revoked'; actor_name: string | null; reason: string | null; at: string }[];
};
type Data = { role: 'owner' | 'admin' | 'analyst' | 'viewer'; links: Link[] };

const STATUS: Record<Link['consent_status'], { label: string; cls: string }> = {
  pending: { label: 'Pendiente de tu autorización', cls: 'text-amber-700 dark:text-amber-400' },
  granted: { label: 'Autorizado', cls: 'text-emerald-700 dark:text-emerald-400' },
  revoked: { label: 'Revocado', cls: 'text-zinc-500' },
};
const card = 'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';
const input = 'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

export default function InsurerReinsurancePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [revoking, setRevoking] = useState<{ id: string; reason: string } | null>(null);
  const reload = useCallback(() => setRefresh((k) => k + 1), []);

  useEffect(() => {
    createClient()
      .rpc('portal_reinsurer_links')
      .then(({ data: d, error: e }) => {
        if (e) setError(e.message);
        else setData(d as unknown as Data);
      });
  }, [refresh]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-zinc-500">Cargando…</p>;
  const owner = data.role === 'owner';

  const setConsent = async (l: Link, grant: boolean, reason?: string) => {
    if (grant) {
      const ok = await confirm({
        title: `¿Autorizar a ${l.reinsurer_name}?`,
        message:
          'Verá cifras agregadas de tus servicios cubiertos (cantidad, costo, frecuencia, SLA y tipo de servicio), nunca casos individuales ni datos de tus afiliados. Puedes revocarlo cuando quieras.',
        confirmLabel: 'Autorizar',
      });
      if (!ok) return;
    }
    const { error: e } = await createClient().rpc('portal_set_reinsurer_consent', {
      p_link: l.id, p_grant: grant, p_reason: reason ?? null,
    } as never);
    if (e) return toast.error(e.message);
    toast.success(grant ? 'Autorización registrada.' : 'Autorización revocada.');
    setRevoking(null);
    reload();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Reaseguro</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Tu reaseguradora puede ver en Budi cifras agregadas de tus servicios, solo si tú lo autorizas. Nunca ve casos
          individuales ni datos de tus afiliados, y una cifra con menos de 5 casos no se le muestra.
          {!owner && ' Solo el dueño del portal puede autorizar o revocar.'}
        </p>
      </div>

      {data.links.length === 0 ? (
        <p className={`${card} p-6 text-center text-sm text-zinc-500`}>Budi no te ha vinculado con ninguna reaseguradora.</p>
      ) : data.links.map((l) => (
        <div key={l.id} className={`${card} space-y-3 p-4`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-zinc-900 dark:text-white">{l.reinsurer_name}</p>
              <p className="text-xs text-zinc-500">Vínculo desde {l.valid_from}{l.valid_to ? ` hasta ${l.valid_to}` : ''}</p>
              <p className={`mt-1 text-sm font-medium ${STATUS[l.consent_status].cls}`}>{STATUS[l.consent_status].label}</p>
            </div>
            {owner && (
              <div className="flex gap-2">
                {l.consent_status !== 'granted' && (
                  <button onClick={() => setConsent(l, true)} className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700">
                    Autorizar
                  </button>
                )}
                {l.consent_status === 'granted' && (
                  <button onClick={() => setRevoking({ id: l.id, reason: '' })} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
                    Revocar
                  </button>
                )}
              </div>
            )}
          </div>

          {revoking?.id === l.id && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
              <label className="min-w-64 flex-1 text-sm">
                Motivo de la revocación
                <input className={input} value={revoking.reason} onChange={(e) => setRevoking({ ...revoking, reason: e.target.value })} />
              </label>
              <button onClick={() => setConsent(l, false, revoking.reason)} disabled={!revoking.reason.trim()} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                Revocar ahora
              </button>
              <button onClick={() => setRevoking(null)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Cancelar</button>
            </div>
          )}

          {l.history.length > 0 && (
            <ul className="space-y-0.5 border-t border-zinc-100 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
              {l.history.map((h, i) => (
                <li key={i}>
                  {formatDateTime(h.at)} · {h.action === 'granted' ? 'Autorizó' : 'Revocó'} {h.actor_name ?? ''}
                  {h.reason ? ` · ${h.reason}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
