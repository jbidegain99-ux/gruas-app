'use client';

import { useState, useEffect, useCallback } from 'react';
import { KeyRound, Plus, Copy, Check, AlertTriangle } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast, useConfirm } from '@/shared/components/FeedbackProvider';
import { formatDate } from '@/shared/lib/format';

// Claves de API de la aseguradora para cargar su padrón (B-10).
//
// La base guarda solo el SHA-256, así que el valor en claro existe únicamente en
// la respuesta de `create_insurer_api_key`. Esta pantalla es la única
// oportunidad de copiarlo: por eso se muestra a pantalla completa y con aviso,
// en vez de en un toast que se va solo a los cuatro segundos.

type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function InsurerApiKeys({ insurerId }: { insurerId: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [nombre, setNombre] = useState('');
  const [creando, setCreando] = useState(false);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [claveNueva, setClaveNueva] = useState<string | null>(null);
  const [copiada, setCopiada] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      // `key_hash` se omite a propósito: no hay motivo para que el hash viaje al
      // navegador aunque el admin tenga permiso de leerlo.
      const { data } = await supabase
        .from('insurer_api_keys')
        .select('id, name, key_prefix, created_at, last_used_at, revoked_at')
        .eq('insurer_id', insurerId)
        .order('created_at', { ascending: false });
      setKeys((data as ApiKey[]) || []);
    };
    load();
  }, [insurerId, refreshKey]);

  const crear = async () => {
    setCreando(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('create_insurer_api_key', {
      p_insurer_id: insurerId,
      p_name: nombre.trim(),
    });
    setCreando(false);
    if (error) return toast.error('No se pudo crear la clave.');

    const r = data as unknown as { key: string };
    setClaveNueva(r.key);
    setNombre('');
    setMostrarForm(false);
    refetch();
  };

  const revocar = async (k: ApiKey) => {
    const ok = await confirm({
      title: `¿Revocar «${k.name}»?`,
      message: 'Cualquier integración que la use dejará de funcionar de inmediato. No se puede deshacer.',
      confirmLabel: 'Revocar',
      destructive: true,
    });
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase.rpc('revoke_insurer_api_key', { p_key_id: k.id });
    if (error) return toast.error('No se pudo revocar la clave.');
    toast.success('Clave revocada.');
    refetch();
  };

  const copiar = async () => {
    if (!claveNueva) return;
    try {
      await navigator.clipboard.writeText(claveNueva);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    } catch {
      toast.error('No se pudo copiar. Seleccioná el texto a mano.');
    }
  };

  const activas = keys.filter((k) => !k.revoked_at);

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">
            Claves de API
          </h2>
          <p className="text-xs text-zinc-500">
            Para que la aseguradora cargue su padrón por su cuenta. Ver{' '}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">docs/API_AFILIADOS.md</code>
          </p>
        </div>
        <button
          onClick={() => setMostrarForm((v) => !v)}
          className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Plus className="h-4 w-4" />
          Nueva clave
        </button>
      </div>

      {claveNueva && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                Copiala ahora: no se vuelve a mostrar
              </p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                Solo guardamos su huella. Si se pierde, hay que revocarla y emitir otra.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900 dark:border-amber-800 dark:bg-zinc-900 dark:text-white">
                  {claveNueva}
                </code>
                <button
                  onClick={copiar}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
                >
                  {copiada ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiada ? 'Copiada' : 'Copiar'}
                </button>
              </div>
              <button
                onClick={() => setClaveNueva(null)}
                className="mt-3 text-xs font-medium text-amber-800 hover:underline dark:text-amber-300"
              >
                Ya la guardé
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarForm && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex-1">
            <label className="block text-xs font-medium text-zinc-500">
              Nombre de la clave
            </label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Carga nocturna de padrón"
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Sirve para saber qué integración revocar más adelante.
            </p>
          </div>
          <button
            onClick={crear}
            disabled={creando || !nombre.trim()}
            className="rounded-lg bg-budi-primary-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
          >
            {creando ? 'Creando…' : 'Crear clave'}
          </button>
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {keys.length === 0 ? (
          <div className="p-8 text-center">
            <KeyRound className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-700" />
            <p className="mt-2 text-sm text-zinc-500">
              Sin claves. La aseguradora todavía no puede cargar su padrón por API.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className="px-6 py-3">Nombre</th>
                  <th className="px-6 py-3">Clave</th>
                  <th className="px-6 py-3">Creada</th>
                  <th className="px-6 py-3">Último uso</th>
                  <th className="px-6 py-3">Estado</th>
                  <th className="px-6 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {keys.map((k) => (
                  <tr key={k.id} className={k.revoked_at ? 'opacity-60' : ''}>
                    <td className="px-6 py-4 font-medium text-zinc-900 dark:text-white">{k.name}</td>
                    <td className="px-6 py-4 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      {k.key_prefix}…
                    </td>
                    <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400">{formatDate(k.created_at)}</td>
                    <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400">
                      {k.last_used_at ? formatDate(k.last_used_at) : 'nunca'}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          k.revoked_at
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        }`}
                      >
                        {k.revoked_at ? 'Revocada' : 'Activa'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {!k.revoked_at && (
                        <button
                          onClick={() => revocar(k)}
                          className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                        >
                          Revocar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {activas.length > 1 && (
        <p className="mt-2 text-xs text-zinc-500">
          Hay {activas.length} claves activas. Conviene una por integración, para poder revocar una
          sin tumbar las demás.
        </p>
      )}
    </section>
  );
}
