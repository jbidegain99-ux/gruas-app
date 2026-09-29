'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, KeyRound, Plus, Webhook } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useConfirm, useToast } from '@/shared/components/FeedbackProvider';
import { formatDateTime } from '@/shared/lib/format';

// Integraciones de la aseguradora (migr. 00129, ASE-04): claves de API para
// cargar el padrón y webhooks con los eventos de sus casos. Solo dueño y
// administradores del portal (con 2FA). Claves y secretos se muestran una vez.

type ApiKey = {
  id: string; name: string; key_prefix: string; created_at: string;
  last_used_at: string | null; revoked_at: string | null; expires_at: string | null;
};
type Hook = {
  id: string; url: string; description: string | null; events: string[]; is_active: boolean;
  created_at: string; delivered_24h: number; failing: number;
};
type Data = { events: string[]; api_keys: ApiKey[]; webhooks: Hook[] };
type Delivery = {
  id: string; event: string; folio: string | null; status: 'pending' | 'sending' | 'delivered' | 'failed';
  attempts: number; next_attempt_at: string; last_status_code: number | null; last_error: string | null;
  created_at: string; delivered_at: string | null; payload: unknown;
};

const EVENT_LABEL: Record<string, string> = {
  'case.created': 'Caso creado',
  'case.assigned': 'Grúa asignada',
  'case.unassigned': 'Socio liberó el caso',
  'case.arrived': 'Grúa llegó (PIN)',
  'case.completed': 'Servicio completado',
  'case.cancelled': 'Caso cancelado',
  ping: 'Prueba',
};
const DELIVERY_STATUS: Record<Delivery['status'], { label: string; cls: string }> = {
  delivered: { label: 'Entregado', cls: 'text-emerald-700 dark:text-emerald-400' },
  sending: { label: 'Enviando', cls: 'text-zinc-500' },
  pending: { label: 'Reintentará', cls: 'text-amber-700 dark:text-amber-400' },
  failed: { label: 'Falló', cls: 'text-red-600 dark:text-red-400' },
};

const input = 'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';
const card = 'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';
const link = 'text-xs font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400';

function keyState(k: ApiKey): { label: string; live: boolean } {
  if (k.revoked_at) return { label: 'Revocada', live: false };
  if (k.expires_at && new Date(k.expires_at) <= new Date()) return { label: 'Vencida', live: false };
  if (k.expires_at) return { label: `Rotada · vence ${formatDateTime(k.expires_at)}`, live: true };
  return { label: 'Activa', live: true };
}

/** Valor que solo se ve una vez (clave o secreto). */
function ShowOnce({ title, value, onDone }: { title: string; value: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('No se pudo copiar. Selecciona el texto a mano.');
    }
  };
  return (
    <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{title}</p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Copia este valor ahora: no se vuelve a mostrar.</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900 dark:border-amber-800 dark:bg-zinc-900 dark:text-white">
              {value}
            </code>
            <button onClick={copy} className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <button onClick={onDone} className="mt-3 text-xs font-medium text-amber-800 hover:underline dark:text-amber-300">
            Ya lo copié
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InsurerIntegrationsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((k) => k + 1), []);

  const [shown, setShown] = useState<{ title: string; value: string } | null>(null);
  const [keyName, setKeyName] = useState<string | null>(null);
  const [editHook, setEditHook] = useState<Partial<Hook> | null>(null);
  const [openHook, setOpenHook] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .rpc('portal_integrations')
      .then(({ data: d, error: e }) => {
        if (e) setError(e.message);
        else setData(d as unknown as Data);
      });
  }, [refresh]);

  if (error) {
    return (
      <div className={`${card} p-6`}>
        <h1 className="font-heading text-xl font-bold text-zinc-900 dark:text-white">Integraciones</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{error}</p>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-zinc-500">Cargando…</p>;

  const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T | null> => {
    const { data: d, error: e } = await createClient().rpc(fn as never, args as never);
    if (e) {
      toast.error(e.message);
      return null;
    }
    return d as T;
  };

  // ── Claves ──
  const createKey = async () => {
    const r = await rpc<{ key: string }>('portal_create_api_key', { p_name: keyName ?? '' });
    if (!r) return;
    setShown({ title: 'Clave de API', value: r.key });
    setKeyName(null);
    reload();
  };
  const rotateKey = async (k: ApiKey) => {
    const ok = await confirm({
      title: `¿Rotar «${k.name}»?`,
      message: 'Se emite una clave nueva con el mismo nombre. La actual sigue funcionando 24 horas para que la cambies sin cortar tu integración.',
      confirmLabel: 'Rotar',
    });
    if (!ok) return;
    const r = await rpc<{ key: string }>('portal_rotate_api_key', { p_id: k.id, p_grace_hours: 24 });
    if (!r) return;
    setShown({ title: 'Clave nueva', value: r.key });
    reload();
  };
  const revokeKey = async (k: ApiKey) => {
    const ok = await confirm({
      title: `¿Revocar «${k.name}»?`,
      message: 'Cualquier integración que la use dejará de funcionar de inmediato. No se puede deshacer.',
      confirmLabel: 'Revocar',
      destructive: true,
    });
    if (!ok) return;
    if ((await rpc('portal_revoke_api_key', { p_id: k.id })) === null) return;
    toast.success('Clave revocada.');
    reload();
  };

  // ── Webhooks ──
  const saveHook = async () => {
    const h = editHook!;
    const r = await rpc<{ id: string; secret?: string }>('portal_save_webhook', {
      p_id: h.id ?? null, p_url: h.url ?? '', p_events: h.events ?? [], p_description: h.description ?? '',
      p_is_active: h.is_active ?? true,
    });
    if (!r) return;
    if (r.secret) setShown({ title: 'Secreto de firma', value: r.secret });
    else toast.success('Webhook guardado.');
    setEditHook(null);
    reload();
  };
  const rotateSecret = async (h: Hook) => {
    const ok = await confirm({
      title: '¿Rotar el secreto de firma?',
      message: 'Desde ahora los eventos se firman con el secreto nuevo. Actualiza tu receptor enseguida o rechazará las entregas (se reintentan hasta 9 horas).',
      confirmLabel: 'Rotar',
    });
    if (!ok) return;
    const r = await rpc<{ secret: string }>('portal_rotate_webhook_secret', { p_id: h.id });
    if (r) setShown({ title: 'Secreto de firma nuevo', value: r.secret });
  };
  const deleteHook = async (h: Hook) => {
    const ok = await confirm({
      title: '¿Eliminar este webhook?',
      message: `Dejarás de recibir eventos en ${h.url}. Su historial de entregas también se borra.`,
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    if ((await rpc('portal_delete_webhook', { p_id: h.id })) === null) return;
    toast.success('Webhook eliminado.');
    reload();
  };
  const testHook = async (h: Hook) => {
    if ((await rpc('portal_test_webhook', { p_id: h.id })) === null) return;
    toast.info('Evento de prueba enviado. Revisa las entregas en unos segundos.');
    setOpenHook(h.id);
  };

  const toggleEvent = (ev: string) => {
    const cur = editHook?.events ?? [];
    setEditHook({ ...editHook, events: cur.includes(ev) ? cur.filter((e) => e !== ev) : [...cur, ev] });
  };

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Integraciones</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Conecta tus sistemas con Budi: carga tu padrón por API y recibe los eventos de tus casos en tu servidor.
          Pide a Budi la guía técnica de la API.
        </p>
      </div>

      {shown && <ShowOnce title={shown.title} value={shown.value} onDone={() => setShown(null)} />}

      {/* Webhooks */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-zinc-900 dark:text-white">Webhooks</h2>
            <p className="text-xs text-zinc-500">Cada evento llega firmado (HMAC-SHA256) y se reintenta si tu servidor no responde 2xx.</p>
          </div>
          {data.webhooks.length < 5 && (
            <button
              onClick={() => setEditHook({ events: data.events.filter((e) => e !== 'case.unassigned'), is_active: true })}
              className="inline-flex items-center gap-1 text-sm font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
            >
              <Plus className="h-4 w-4" /> Nuevo webhook
            </button>
          )}
        </div>

        {editHook && (
          <div className={`${card} mb-3 space-y-3 p-4`}>
            <label className="block text-sm">
              URL de tu servidor
              <input className={input} value={editHook.url ?? ''} placeholder="https://api.tuaseguradora.com/budi/eventos"
                     onChange={(e) => setEditHook({ ...editHook, url: e.target.value })} />
            </label>
            <label className="block text-sm">
              Descripción (opcional)
              <input className={input} value={editHook.description ?? ''} placeholder="Sistema de siniestros"
                     onChange={(e) => setEditHook({ ...editHook, description: e.target.value })} />
            </label>
            <fieldset>
              <legend className="text-sm">Eventos</legend>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {data.events.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editHook.events?.includes(ev) ?? false} onChange={() => toggleEvent(ev)} />
                    {EVENT_LABEL[ev] ?? ev} <code className="text-xs text-zinc-400">{ev}</code>
                  </label>
                ))}
              </div>
            </fieldset>
            {editHook.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editHook.is_active ?? true} onChange={(e) => setEditHook({ ...editHook, is_active: e.target.checked })} />
                Activo
              </label>
            )}
            <div className="flex gap-2">
              <button onClick={saveHook} className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700">Guardar</button>
              <button onClick={() => setEditHook(null)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Cancelar</button>
            </div>
          </div>
        )}

        <div className={`${card} divide-y divide-zinc-100 dark:divide-zinc-800`}>
          {data.webhooks.length === 0 ? (
            <div className="p-8 text-center">
              <Webhook className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-700" />
              <p className="mt-2 text-sm text-zinc-500">Aún no recibes eventos. Agrega la URL de tu servidor.</p>
            </div>
          ) : data.webhooks.map((h) => (
            <div key={h.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all font-mono text-sm text-zinc-900 dark:text-white">{h.url}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {h.description ? `${h.description} · ` : ''}
                    {h.is_active ? 'Activo' : 'Pausado'} · {h.delivered_24h} entregados en 24 h
                    {h.failing > 0 && <span className="text-red-600 dark:text-red-400"> · {h.failing} con fallas</span>}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {h.events.map((ev) => (
                      <span key={ev} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{EVENT_LABEL[ev] ?? ev}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => testHook(h)} className={link}>Enviar prueba</button>
                  <button onClick={() => setOpenHook(openHook === h.id ? null : h.id)} className={link}>
                    {openHook === h.id ? 'Ocultar entregas' : 'Entregas'}
                  </button>
                  <button onClick={() => setEditHook(h)} className={link}>Editar</button>
                  <button onClick={() => rotateSecret(h)} className={link}>Rotar secreto</button>
                  <button onClick={() => deleteHook(h)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">Eliminar</button>
                </div>
              </div>
              {openHook === h.id && <Deliveries hookId={h.id} />}
            </div>
          ))}
        </div>
      </section>

      {/* Claves de API */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-zinc-900 dark:text-white">Claves de API</h2>
            <p className="text-xs text-zinc-500">Para cargar tu padrón de afiliados desde tus sistemas. Usa una clave por integración.</p>
          </div>
          <button onClick={() => setKeyName(keyName === null ? '' : null)} className="inline-flex items-center gap-1 text-sm font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
            <Plus className="h-4 w-4" /> Nueva clave
          </button>
        </div>

        {keyName !== null && (
          <div className={`${card} mb-3 flex flex-wrap items-end gap-3 p-4`}>
            <label className="flex-1 text-sm">
              Nombre de la clave
              <input className={input} value={keyName} placeholder="Carga nocturna de padrón" onChange={(e) => setKeyName(e.target.value)} />
            </label>
            <button onClick={createKey} disabled={!keyName.trim()} className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700 disabled:opacity-50">
              Crear clave
            </button>
          </div>
        )}

        <div className={`${card} overflow-x-auto`}>
          {data.api_keys.length === 0 ? (
            <div className="p-8 text-center">
              <KeyRound className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-700" />
              <p className="mt-2 text-sm text-zinc-500">Sin claves todavía.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Nombre</th><th className="px-4 py-3">Clave</th><th className="px-4 py-3">Último uso</th>
                  <th className="px-4 py-3">Estado</th><th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.api_keys.map((k) => {
                  const st = keyState(k);
                  return (
                    <tr key={k.id} className={st.live ? '' : 'text-zinc-400'}>
                      <td className="px-4 py-3">{k.name}<p className="text-xs text-zinc-500">Creada {formatDateTime(k.created_at)}</p></td>
                      <td className="px-4 py-3 font-mono text-xs">{k.key_prefix}…</td>
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{k.last_used_at ? formatDateTime(k.last_used_at) : 'Nunca'}</td>
                      <td className="px-4 py-3">{st.label}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {st.live && (
                          <span className="flex justify-end gap-3">
                            {!k.expires_at && <button onClick={() => rotateKey(k)} className={link}>Rotar</button>}
                            <button onClick={() => revokeKey(k)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">Revocar</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function Deliveries({ hookId }: { hookId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const load = () =>
      createClient()
        .rpc('portal_webhook_deliveries', { p_webhook: hookId, p_limit: 50 })
        .then(({ data, error }) => {
          if (error) toast.error(error.message);
          else setRows(data as unknown as Delivery[]);
        });
    load();
    // Lo que está en vuelo se resuelve en segundos: refresco mientras está abierto.
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [hookId, refresh, toast]);

  const redeliver = async (d: Delivery) => {
    const { error } = await createClient().rpc('portal_redeliver_webhook', { p_delivery: d.id });
    if (error) return toast.error(error.message);
    toast.info('Reenviado.');
    setRefresh((k) => k + 1);
  };

  if (!rows) return <p className="mt-3 text-xs text-zinc-500">Cargando entregas…</p>;
  if (rows.length === 0) return <p className="mt-3 text-xs text-zinc-500">Sin entregas todavía. Usa «Enviar prueba».</p>;

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-xs">
        <thead className="text-left uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Evento</th><th className="px-3 py-2">Caso</th>
            <th className="px-3 py-2">Resultado</th><th className="px-3 py-2 text-right">Intentos</th><th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((d) => (
            <Fragment key={d.id}>
              <tr>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(d.created_at)}</td>
                <td className="px-3 py-2">{EVENT_LABEL[d.event] ?? d.event}</td>
                <td className="px-3 py-2 font-mono">{d.folio}</td>
                <td className="px-3 py-2">
                  <span className={DELIVERY_STATUS[d.status].cls}>{DELIVERY_STATUS[d.status].label}</span>
                  {d.last_error && d.status !== 'delivered' && <span className="text-zinc-500"> · {d.last_error}</span>}
                  {d.status === 'pending' && d.attempts > 0 && <span className="text-zinc-500"> · {formatDateTime(d.next_attempt_at)}</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{d.attempts}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button onClick={() => setOpen(open === d.id ? null : d.id)} className={link}>{open === d.id ? 'Ocultar' : 'Ver cuerpo'}</button>
                  {(d.status === 'failed' || d.status === 'delivered') && (
                    <button onClick={() => redeliver(d)} className={`${link} ml-3`}>Reenviar</button>
                  )}
                </td>
              </tr>
              {open === d.id && (
                <tr>
                  <td colSpan={6} className="bg-zinc-50 px-3 py-2 dark:bg-zinc-950">
                    <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                      {JSON.stringify(d.payload, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
