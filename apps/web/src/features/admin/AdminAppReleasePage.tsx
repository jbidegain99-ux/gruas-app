'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm, useToast } from '@/shared/components/FeedbackProvider';
import { createClient } from '@/shared/lib/supabase/client';
import { formatDate } from '@/shared/lib/format';
import { setInsurersEnabled } from '@/shared/lib/platform-features';
import { invalidatePlatformFeatures, useInsurersEnabled } from '@/shared/lib/use-platform-features';

// Política de versión de la app móvil (backlog APP-09, migr. 00118). Subir la
// versión mínima deja fuera a quien no actualice: la app le muestra
// "Actualiza la app" y no deja seguir. Los cambios de JavaScript llegan por
// aire (eas update) y no necesitan esto; es para un binario incompatible.

type Policy = {
  platform: 'android' | 'ios';
  min_version: string;
  latest_version: string;
  store_url: string | null;
  updated_at: string;
};

const LABEL: Record<Policy['platform'], string> = { android: 'Android', ios: 'iPhone (iOS)' };
const SEMVER = /^\d+\.\d+\.\d+$/;

export default function AdminAppReleasePage() {
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    createClient()
      .rpc('admin_app_release_policy')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) toast.error(error.message);
        setPolicies((data as Policy[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, toast]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">App móvil</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Qué versiones de la app pueden seguir usándose. Por debajo de la <strong>mínima</strong>, la app muestra
          “Actualiza la app” y no deja continuar. Por debajo de la <strong>última</strong>, solo avisa que hay una
          nueva.
        </p>
      </div>
      <InsurersSwitch />
      {policies === null ? (
        <p className="text-sm text-zinc-500">Cargando…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {policies.map((p) => (
            <PolicyCard key={p.platform} policy={p} onSaved={() => setRefreshKey((k) => k + 1)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PolicyCard({ policy, onSaved }: { policy: Policy; onSaved: () => void }) {
  const [min, setMin] = useState(policy.min_version);
  const [latest, setLatest] = useState(policy.latest_version);
  const [url, setUrl] = useState(policy.store_url ?? '');
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const valid = SEMVER.test(min) && SEMVER.test(latest);
  const changed = min !== policy.min_version || latest !== policy.latest_version || url !== (policy.store_url ?? '');

  const save = async () => {
    if (min !== policy.min_version) {
      const ok = await confirm({
        title: `¿Exigir la versión ${min} en ${LABEL[policy.platform]}?`,
        message: 'Quien tenga una versión anterior no podrá usar la app hasta actualizar, incluso a mitad de un servicio.',
        confirmLabel: 'Sí, exigirla',
        destructive: true,
      });
      if (!ok) return;
    }
    setSaving(true);
    const { error } = await createClient().rpc('admin_set_app_release_policy', {
      p_platform: policy.platform,
      p_min_version: min,
      p_latest_version: latest,
      p_store_url: url,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Política guardada.');
    onSaved();
  };

  const input =
    'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-heading text-lg font-semibold text-zinc-900 dark:text-white">{LABEL[policy.platform]}</h2>
      <p className="mb-4 text-xs text-zinc-500">Último cambio: {formatDate(policy.updated_at)}</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-zinc-700 dark:text-zinc-300">
          Versión mínima
          <input className={input} value={min} onChange={(e) => setMin(e.target.value.trim())} placeholder="1.0.0" />
        </label>
        <label className="text-sm text-zinc-700 dark:text-zinc-300">
          Última publicada
          <input className={input} value={latest} onChange={(e) => setLatest(e.target.value.trim())} placeholder="1.0.0" />
        </label>
      </div>
      <label className="mt-3 block text-sm text-zinc-700 dark:text-zinc-300">
        Enlace a la tienda
        <input className={input} value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://…" />
      </label>
      {!valid && <p className="mt-2 text-xs text-red-600">Las versiones van en formato 1.2.3.</p>}
      <button
        onClick={save}
        disabled={!valid || !changed || saving}
        className="mt-4 rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-600 disabled:opacity-50"
      >
        {saving ? 'Guardando…' : 'Guardar'}
      </button>
    </section>
  );
}

/**
 * Interruptor de aseguradoras (migr. 00153). Apagado: sin cobertura al pedir
 * (todo va particular o cortesía MOPT), sin portales de aseguradora ni de
 * reaseguradora, y sus pantallas fuera del panel y de la app. No borra nada.
 */
function InsurersSwitch() {
  const enabled = useInsurersEnabled();
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();

  const toggle = async () => {
    const next = !enabled;
    const ok = await confirm({
      title: next ? '¿Activar las aseguradoras?' : '¿Poner en pausa las aseguradoras?',
      message: next
        ? 'Vuelve la cobertura de seguro al pedir un servicio, se abren los portales de aseguradoras y reaseguradoras y sus pantallas reaparecen en el panel y en la app.'
        : 'Los pedidos nuevos van como particulares o cortesía MOPT, se cierran los portales de aseguradoras y reaseguradoras y sus pantallas se ocultan. No se borra nada.',
      confirmLabel: next ? 'Sí, activarlas' : 'Sí, pausarlas',
      destructive: !next,
    });
    if (!ok) return;
    setSaving(true);
    const error = await setInsurersEnabled(createClient(), next);
    setSaving(false);
    if (error) return toast.error(error);
    invalidatePlatformFeatures();
    toast.success(next ? 'Aseguradoras activas.' : 'Aseguradoras en pausa.');
    // El layout del panel relee el interruptor: menú y pantallas se actualizan.
    router.refresh();
  };

  return (
    <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="max-w-2xl">
        <h2 className="font-heading text-lg font-semibold text-zinc-900 dark:text-white">
          Aseguradoras{' '}
          <span
            className={`ml-1 inline-flex rounded-full px-2 py-0.5 align-middle text-xs font-medium ${
              enabled
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {enabled ? 'Activas' : 'En pausa'}
          </span>
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Cobertura de seguro, pólizas, afiliados, copagos y los portales de aseguradoras y reaseguradoras, en la web y en la
          app. En pausa no se borra nada: activarlas deja todo como estaba.
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={saving}
        className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
          enabled
            ? 'border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
            : 'bg-budi-primary-500 text-white hover:bg-budi-primary-600'
        }`}
      >
        {saving ? 'Guardando…' : enabled ? 'Poner en pausa' : 'Activar'}
      </button>
    </section>
  );
}
