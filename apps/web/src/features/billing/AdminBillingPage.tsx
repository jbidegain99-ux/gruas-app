'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { useInsurersEnabled } from '@/shared/lib/use-platform-features';
import { missingFields, type DteType, type Emisor, type Receptor } from './dte';

// LAN-09 (base, migr. 00140): datos fiscales para la factura electrónica.
// Emisor (Budi), establecimiento y punto de venta, y por cliente el tipo de
// documento y sus datos de receptor. Qué documento aplica a cada cliente y el
// trato del IVA los confirma el contador.

type Client = { organization_id: string; name: string; type: 'MOPT' | 'INSURER'; dte_type: DteType; receptor: Partial<Receptor>; configured: boolean };
type Data = {
  settings: { emisor: Partial<Emisor>; ambiente: '00' | '01'; cod_estable: string; cod_punto_venta: string; prices_include_iva: boolean };
  clients: Client[];
};

const input = 'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';
const card = 'rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900';

function Field({ label, value, onChange, placeholder, id }: { label: string; value: string | null | undefined; onChange: (v: string) => void; placeholder?: string; id: string }) {
  return (
    <label className="text-sm" htmlFor={id}>
      {label}
      <input id={id} className={input} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function DireccionFields({ prefix, value, onChange }: { prefix: string; value: Partial<Emisor['direccion']> | null | undefined; onChange: (v: Emisor['direccion']) => void }) {
  const v = { departamento: '', municipio: '', complemento: '', ...(value ?? {}) };
  return (
    <>
      <Field id={`${prefix}-dep`} label="Departamento (código MH)" value={v.departamento} placeholder="06" onChange={(x) => onChange({ ...v, departamento: x })} />
      <Field id={`${prefix}-mun`} label="Municipio (código MH)" value={v.municipio} placeholder="14" onChange={(x) => onChange({ ...v, municipio: x })} />
      <div className="sm:col-span-2">
        <Field id={`${prefix}-comp`} label="Dirección" value={v.complemento} onChange={(x) => onChange({ ...v, complemento: x })} />
      </div>
    </>
  );
}

export default function AdminBillingPage() {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  // Si la consulta falla, se dice (antes quedaba "Cargando…" para siempre).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((k) => k + 1), []);
  // Aseguradoras en pausa (00153): solo los receptores del MOPT.
  const insurers = useInsurersEnabled();

  useEffect(() => {
    createClient()
      .rpc('admin_dte_settings')
      .then(({ data: d, error }) => {
        if (error) {
          toast.error(error.message);
          setLoadError(error.message);
        } else {
          setLoadError(null);
          setData(d as unknown as Data);
        }
      });
  }, [refresh, toast]);

  if (!data)
    return loadError ? (
      <p className="text-sm text-red-600 dark:text-red-400">No se pudo cargar: {loadError}</p>
    ) : (
      <p className="text-sm text-zinc-500">Cargando…</p>
    );
  const s = data.settings;
  const e = s.emisor;
  const setS = (patch: Partial<Data['settings']>) => setData({ ...data, settings: { ...s, ...patch } });
  const setE = (patch: Partial<Emisor>) => setS({ emisor: { ...e, ...patch } });

  const saveSettings = async () => {
    const { error } = await createClient().rpc('admin_save_dte_settings', {
      p_emisor: e, p_ambiente: s.ambiente, p_cod_estable: s.cod_estable, p_cod_punto_venta: s.cod_punto_venta,
      p_prices_include_iva: s.prices_include_iva,
    } as never);
    if (error) return toast.error(error.message);
    toast.success('Datos del emisor guardados.');
    reload();
  };

  const saveClient = async (c: Client) => {
    const { error } = await createClient().rpc('admin_save_org_fiscal', { p_org: c.organization_id, p_dte_type: c.dte_type, p_receptor: c.receptor } as never);
    if (error) return toast.error(error.message);
    toast.success(`Datos fiscales de ${c.name} guardados.`);
    setOpen(null);
    reload();
  };

  const setClient = (id: string, patch: Partial<Client>) =>
    setData({ ...data, clients: data.clients.map((c) => (c.organization_id === id ? { ...c, ...patch } : c)) });

  const emisorMissing = missingFields('01', e, { nombre: 'x' });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Facturación electrónica</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Datos fiscales para armar el DTE de cada estado de cuenta aprobado. Por ahora el DTE se genera como borrador para
          revisarlo con el contador: la firma y el envío a Hacienda llegan con el certificado y las credenciales del MH.
        </p>
      </div>

      <section className={`${card} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-zinc-900 dark:text-white">Emisor (Budi)</h2>
          <span className={`text-xs ${emisorMissing.length ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
            {emisorMissing.length ? `Faltan ${emisorMissing.length} dato(s)` : 'Completo'}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="em-nombre" label="Razón social" value={e.nombre} onChange={(v) => setE({ nombre: v })} />
          <Field id="em-comercial" label="Nombre comercial" value={e.nombreComercial} onChange={(v) => setE({ nombreComercial: v })} />
          <Field id="em-nit" label="NIT (sin guiones)" value={e.nit} onChange={(v) => setE({ nit: v.replace(/\D/g, '') })} />
          <Field id="em-nrc" label="NRC (sin guiones)" value={e.nrc} onChange={(v) => setE({ nrc: v.replace(/\D/g, '') })} />
          <Field id="em-act" label="Código de actividad económica" value={e.codActividad} onChange={(v) => setE({ codActividad: v })} />
          <Field id="em-actd" label="Actividad económica" value={e.descActividad} onChange={(v) => setE({ descActividad: v })} />
          <DireccionFields prefix="em" value={e.direccion} onChange={(v) => setE({ direccion: v })} />
          <Field id="em-tel" label="Teléfono" value={e.telefono} onChange={(v) => setE({ telefono: v })} />
          <Field id="em-correo" label="Correo" value={e.correo} onChange={(v) => setE({ correo: v })} />
          <Field id="em-tipoest" label="Tipo de establecimiento (código MH)" value={e.tipoEstablecimiento ?? '02'} onChange={(v) => setE({ tipoEstablecimiento: v })} />
          <label className="text-sm" htmlFor="em-amb">
            Ambiente
            <select id="em-amb" className={input} value={s.ambiente} onChange={(ev) => setS({ ambiente: ev.target.value as '00' | '01' })}>
              <option value="00">00 · Pruebas</option>
              <option value="01">01 · Producción</option>
            </select>
          </label>
          <Field id="em-est" label="Código de establecimiento (4)" value={s.cod_estable} onChange={(v) => setS({ cod_estable: v.toUpperCase().slice(0, 4) })} />
          <Field id="em-pv" label="Código de punto de venta (4)" value={s.cod_punto_venta} onChange={(v) => setS({ cod_punto_venta: v.toUpperCase().slice(0, 4) })} />
          <label className="flex items-center gap-2 text-sm sm:col-span-2" htmlFor="em-iva">
            <input id="em-iva" type="checkbox" checked={s.prices_include_iva} onChange={(ev) => setS({ prices_include_iva: ev.target.checked })} />
            Los precios de la plataforma ya incluyen IVA (confirmar con el contador)
          </label>
        </div>
        <button onClick={saveSettings} className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700">Guardar emisor</button>
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-zinc-900 dark:text-white">Clientes</h2>
        <div className={`${card} divide-y divide-zinc-100 p-0 dark:divide-zinc-800`}>
          {data.clients.filter((c) => insurers || c.type !== 'INSURER').map((c) => {
            const missing = missingFields(c.dte_type, { ...e, nit: 'x', nrc: 'x', nombre: 'x', codActividad: 'x', descActividad: 'x', telefono: 'x', correo: 'x', direccion: { departamento: '01', municipio: '01', complemento: 'x' } }, { nombre: c.name, ...c.receptor });
            const r = c.receptor;
            const setR = (patch: Partial<Receptor>) => setClient(c.organization_id, { receptor: { ...r, ...patch } });
            return (
              <div key={c.organization_id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-white">{c.name}</p>
                    <p className="text-xs text-zinc-500">
                      {c.type === 'MOPT' ? 'Programa MOPT' : 'Aseguradora'} · {c.dte_type === '01' ? 'Factura (01)' : 'Crédito fiscal (03)'} ·{' '}
                      <span className={missing.length ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
                        {missing.length ? `faltan ${missing.length} dato(s)` : 'completo'}
                      </span>
                    </p>
                  </div>
                  <button onClick={() => setOpen(open === c.organization_id ? null : c.organization_id)} className="text-xs font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                    {open === c.organization_id ? 'Cerrar' : 'Editar datos fiscales'}
                  </button>
                </div>
                {open === c.organization_id && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm sm:col-span-2" htmlFor={`tipo-${c.organization_id}`}>
                      Documento que se le emite
                      <select id={`tipo-${c.organization_id}`} className={input} value={c.dte_type} onChange={(ev) => setClient(c.organization_id, { dte_type: ev.target.value as DteType })}>
                        <option value="03">03 · Comprobante de crédito fiscal</option>
                        <option value="01">01 · Factura</option>
                      </select>
                    </label>
                    <Field id={`n-${c.organization_id}`} label="Razón social" value={r.nombre ?? c.name} onChange={(v) => setR({ nombre: v })} />
                    <Field id={`nc-${c.organization_id}`} label="Nombre comercial" value={r.nombreComercial} onChange={(v) => setR({ nombreComercial: v })} />
                    <Field id={`nit-${c.organization_id}`} label="NIT (sin guiones)" value={r.nit} onChange={(v) => setR({ nit: v.replace(/\D/g, '') })} />
                    <Field id={`nrc-${c.organization_id}`} label="NRC (sin guiones)" value={r.nrc} onChange={(v) => setR({ nrc: v.replace(/\D/g, '') })} />
                    <Field id={`act-${c.organization_id}`} label="Código de actividad" value={r.codActividad} onChange={(v) => setR({ codActividad: v })} />
                    <Field id={`actd-${c.organization_id}`} label="Actividad económica" value={r.descActividad} onChange={(v) => setR({ descActividad: v })} />
                    <DireccionFields prefix={`r-${c.organization_id}`} value={r.direccion as Emisor['direccion'] | undefined} onChange={(v) => setR({ direccion: v })} />
                    <Field id={`tel-${c.organization_id}`} label="Teléfono" value={r.telefono} onChange={(v) => setR({ telefono: v })} />
                    <Field id={`co-${c.organization_id}`} label="Correo para recibir el DTE" value={r.correo} onChange={(v) => setR({ correo: v })} />
                    {missing.length > 0 && (
                      <p className="text-xs text-amber-700 sm:col-span-2 dark:text-amber-400">Falta: {missing.join(', ').replace(/Receptor: /g, '')}</p>
                    )}
                    <div className="sm:col-span-2">
                      <button onClick={() => saveClient(c)} className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700">Guardar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
