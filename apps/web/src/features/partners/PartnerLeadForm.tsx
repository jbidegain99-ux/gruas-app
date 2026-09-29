'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, MessageCircle } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { normalizeSvPhone, PARTNER_SERVICES, PARTNER_VEHICLE_TYPES, SV_DEPARTMENTS } from './partner-options';

// Pre-registro de socios (backlog AGT-01, migr. 00114): cinco datos y listo,
// sin cuenta ni app. Crea un "lead" que el equipo de Budi ve en el panel y le
// deja preparada la bienvenida por WhatsApp o correo.

const input =
  'mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

const WHATSAPP = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');

export function PartnerLeadForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [zone, setZone] = useState('');
  const [vehicle, setVehicle] = useState('');
  // Campo trampa: invisible para personas, los bots lo llenan.
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const toggle = (v: string) => setServices((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const tel = normalizeSvPhone(phone);
    if (!tel) return setError('Escribe un teléfono de El Salvador de 8 dígitos (por ejemplo 7012-3456).');
    if (services.length === 0) return setError('Elige al menos un servicio que puedes prestar.');
    setSending(true);
    const { error: rpcError } = await createClient().rpc('submit_partner_lead', {
      p_full_name: name.trim(),
      p_phone: tel,
      p_email: email.trim() || null,
      p_service_types: services,
      p_zone: zone,
      p_vehicle_type: vehicle,
      p_website: website,
    } as unknown as { p_full_name: string; p_phone: string; p_service_types: string[]; p_zone: string; p_vehicle_type: string });
    setSending(false);
    if (rpcError) return setError(rpcError.message);
    setDone(true);
  };

  if (done) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center dark:border-green-900 dark:bg-green-950/40">
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-600 dark:text-green-400" />
        <h3 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-white">¡Gracias, {name.split(' ')[0]}!</h3>
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          Recibimos tus datos. Te vamos a escribir por WhatsApp para darte la bienvenida y ayudarte con el registro.
        </p>
        <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/socios/registro"
            className="rounded-lg bg-budi-primary-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-budi-primary-600"
          >
            Completar mi registro ahora
          </Link>
          {WHATSAPP && (
            <a
              href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Hola, soy ${name.trim()} y quiero ser socio operador de Budi.`)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-5 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <MessageCircle className="h-4 w-4" /> Escribirnos por WhatsApp
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Nombre completo
          <input required minLength={3} value={name} onChange={(e) => setName(e.target.value)} className={input} autoComplete="name" />
        </label>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Teléfono (WhatsApp)
          <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="7012-3456" className={input} autoComplete="tel" inputMode="tel" />
        </label>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Correo <span className="font-normal text-zinc-500">(opcional)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoComplete="email" />
        </label>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Zona donde trabajas
          <select required value={zone} onChange={(e) => setZone(e.target.value)} className={input}>
            <option value="">Elige un departamento</option>
            {SV_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 sm:col-span-2">
          Tipo de vehículo
          <select required value={vehicle} onChange={(e) => setVehicle(e.target.value)} className={input}>
            <option value="">Elige tu vehículo</option>
            {PARTNER_VEHICLE_TYPES.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Servicios que puedes prestar</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PARTNER_SERVICES.map((s) => (
            <label key={s.value} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={services.includes(s.value)} onChange={() => toggle(s.value)} />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      {/* Trampa para bots: fuera de pantalla y fuera del orden de tabulación. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />
      <button
        type="submit"
        disabled={sending}
        className="w-full rounded-lg bg-budi-primary-500 px-5 py-3 text-sm font-semibold text-white hover:bg-budi-primary-600 disabled:opacity-50 sm:w-auto"
      >
        {sending ? 'Enviando…' : 'Quiero ser socio'}
      </button>
      <p className="text-xs text-zinc-500">
        Usamos estos datos solo para contactarte sobre tu registro. Consulta el{' '}
        <Link href="/privacidad" className="underline">aviso de privacidad</Link>.
      </p>
    </form>
  );
}
