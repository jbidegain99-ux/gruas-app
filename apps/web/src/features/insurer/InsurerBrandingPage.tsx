'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUp, ShieldCheck } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { BRAND_BUCKET, LOGO_TYPES, MAX_LOGO_BYTES, contrastRatio, isHexColor, logoUrl, textOn, type Branding } from './brand';

// ASE-05 (00135): marca blanca. La aseguradora pone su logo, nombre comercial
// y color en su portal y en la app de sus afiliados ("con tecnología Budi").
// Editan dueño y administradores; el resto la ve.

const input = 'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';
const card = 'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';

export default function InsurerBrandingPage() {
  const toast = useToast();
  const router = useRouter();
  const [b, setB] = useState<Branding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ enabled: false, name: '', color: '#1F4E79', logo: null as string | null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    createClient()
      .rpc('portal_branding')
      .then(({ data, error: e }) => {
        if (e) return setError(e.message);
        const d = data as unknown as Branding;
        setB(d);
        setForm({ enabled: d.enabled, name: d.brand_name ?? '', color: d.color ?? '#1F4E79', logo: d.logo_path });
      });
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!b) return <p className="text-sm text-zinc-500">Cargando…</p>;
  const edit = !!b.can_edit;
  const logo = logoUrl(form.logo);
  const colorOk = isHexColor(form.color);
  const lowContrast = colorOk && contrastRatio(form.color, '#FFFFFF') < 3 && contrastRatio(form.color, '#111827') < 3;

  const upload = async (file: File) => {
    if (!LOGO_TYPES.includes(file.type)) return toast.error('Usa PNG, JPG o WEBP.');
    if (file.size > MAX_LOGO_BYTES) return toast.error('El logo pesa más de 512 KB.');
    setBusy(true);
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    // Nombre nuevo en cada subida: la URL pública cambia y nadie ve el logo viejo cacheado.
    const path = `${b.insurer_id}/logo-${Date.now()}.${ext}`;
    const { error: e } = await createClient().storage.from(BRAND_BUCKET).upload(path, file, { contentType: file.type });
    setBusy(false);
    if (e) return toast.error(`No se pudo subir el logo: ${e.message}`);
    setForm((f) => ({ ...f, logo: path }));
    toast.info('Logo cargado. Guarda para aplicarlo.');
  };

  const save = async () => {
    setBusy(true);
    const { error: e } = await createClient().rpc('portal_save_branding', {
      p_enabled: form.enabled, p_name: form.name, p_color: colorOk ? form.color : null, p_logo_path: form.logo,
    } as never);
    setBusy(false);
    if (e) return toast.error(e.message);
    toast.success(form.enabled ? 'Marca guardada y activa.' : 'Marca guardada (desactivada).');
    router.refresh();
  };

  const brandName = form.name.trim() || 'Asistencia Vial';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Marca</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Tu logo, nombre comercial y color en este portal y en la app de tus afiliados, con la leyenda
          «con tecnología Budi». Solo lo ven tus afiliados con póliza vigente.
          {!edit && ' Solo el dueño y los administradores del portal pueden cambiarla.'}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={`${card} space-y-4 p-4`}>
          <label className="block text-sm">
            Nombre comercial
            <input className={input} value={form.name} maxLength={60} disabled={!edit} placeholder="Asistencia Vial Seguros XYZ"
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <div className="text-sm">
            Color
            <div className="mt-1 flex items-center gap-2">
              <input type="color" aria-label="Elegir color" value={colorOk ? form.color : '#1F4E79'} disabled={!edit}
                     onChange={(e) => setForm({ ...form, color: e.target.value.toUpperCase() })} className="h-10 w-14 cursor-pointer rounded border border-zinc-300 dark:border-zinc-700" />
              <input className={`${input} mt-0 w-32 font-mono`} value={form.color} disabled={!edit}
                     onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
            {!colorOk && <p className="mt-1 text-xs text-red-600">Usa el formato #RRGGBB.</p>}
            {lowContrast && <p className="mt-1 text-xs text-amber-700">Ese color casi no contrasta con texto: puede leerse mal.</p>}
          </div>
          <div className="text-sm">
            Logo
            <div className="mt-1 flex items-center gap-3">
              <div className="flex h-14 w-32 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="Logo" className="max-h-12 max-w-[120px] object-contain" />
                ) : (
                  <span className="text-xs text-zinc-400">Sin logo</span>
                )}
              </div>
              {edit && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                  <ImageUp className="h-4 w-4" /> Subir
                  <input type="file" accept={LOGO_TYPES.join(',')} className="sr-only" disabled={busy}
                         onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                </label>
              )}
              {edit && form.logo && (
                <button onClick={() => setForm({ ...form, logo: null })} className="text-xs text-red-600 hover:underline">Quitar</button>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-500">PNG, JPG o WEBP, hasta 512 KB. Mejor horizontal y con fondo transparente.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} disabled={!edit} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Mostrar mi marca en el portal y en la app de mis afiliados
          </label>
          {edit && (
            <button onClick={save} disabled={busy || !colorOk || (form.enabled && !form.name.trim())}
                    className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700 disabled:opacity-50">
              Guardar
            </button>
          )}
        </div>

        {/* Vista previa */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Vista previa en la app del afiliado</p>
          <div className="mx-auto w-full max-w-xs rounded-3xl border-8 border-zinc-800 bg-zinc-50 p-3 dark:bg-zinc-950">
            <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-900">
              <div className="h-1.5" style={{ backgroundColor: colorOk ? form.color : '#1F4E79' }} />
              <div className="flex items-center gap-3 p-3">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="h-10 w-10 rounded object-contain" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded" style={{ backgroundColor: colorOk ? form.color : '#1F4E79', color: textOn(colorOk ? form.color : '#1F4E79') }}>
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{brandName}</p>
                  <p className="text-[11px] text-zinc-500">con tecnología Budi</p>
                </div>
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-zinc-500">Tarjeta en el inicio de la app</p>
          </div>
        </div>
      </div>
    </div>
  );
}
