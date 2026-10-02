import Link from 'next/link';
import {
  BadgeCheck,
  CalendarClock,
  FileCheck2,
  HandCoins,
  MapPin,
  ShieldCheck,
  Smartphone,
  Truck,
  Wallet,
} from 'lucide-react';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { insurersOn } from '@/shared/lib/insurers-public';
import { PartnerLeadForm } from './PartnerLeadForm';

// Landing "Trabaja con Budi" (backlog AGT-01): el embudo de captación de
// socios operadores que llegan sin conocernos. Pública, sin sesión.
// Nunca publica el porcentaje de comisión (regla del backlog): el socio lo ve
// en su liquidación.

// Aseguradoras en pausa (00153): sin el interruptor, ni beneficios ni respuestas
// las mencionan.
const beneficios = (insurers: boolean) => [
  { Icon: MapPin, title: 'Solicitudes cerca de ti', text: 'Te llegan servicios de tu zona. Ves la distancia y el recorrido antes de aceptar.' },
  { Icon: CalendarClock, title: 'Tú decides cuándo', text: 'Te conectas cuando quieres trabajar y te desconectas cuando no. Sin turnos fijos.' },
  { Icon: Wallet, title: 'Pagos claros', text: 'En la app ves lo que cobras por cada servicio y tu liquidación semanal, sin sorpresas.' },
  { Icon: ShieldCheck, title: 'Clientes que pagan', text: insurers
    ? 'Atiendes afiliados de aseguradoras y el programa de asistencia vial del MOPT, además de particulares.'
    : 'Atiendes el programa de asistencia vial del MOPT, además de particulares.' },
];

const REQUISITOS = [
  'DUI vigente',
  'Licencia de conducir vigente',
  'NIT',
  'Tarjeta de circulación de tu unidad',
  'Seguro vigente del vehículo',
  'Fotos de tu unidad (grúa, pipa o vehículo de servicio)',
  'Cuenta bancaria a tu nombre para recibir tus pagos',
  'Un teléfono Android o iPhone',
];

const PASOS = [
  { Icon: Smartphone, title: 'Regístrate', text: 'Desde esta página o desde la app. Puedes guardar y seguir después.' },
  { Icon: FileCheck2, title: 'Sube tus documentos', text: 'Revisamos cada documento y te avisamos si alguno necesita corrección.' },
  { Icon: BadgeCheck, title: 'Te aprobamos', text: 'Con tu cuenta aprobada empiezas a recibir solicitudes en la app.' },
  { Icon: Truck, title: 'Atiende y cobra', text: 'Confirmas cada servicio con el PIN de confirmación del Usuario y se registra tu pago.' },
];

const preguntas = (insurers: boolean) => [
  { q: '¿Necesito tener una empresa?', a: 'No. Puedes registrarte como socio independiente con tu propia unidad, o como parte de una empresa de grúas que ya trabaja con Budi.' },
  { q: '¿Cómo me pagan?', a: 'Por cada servicio completado, Budi retiene una comisión acordada y te liquida el resto a tu cuenta bancaria. Los servicios del programa del MOPT los paga el programa. Todo el detalle lo ves en la app.' },
  { q: '¿Le cobro al Usuario?', a: insurers
    ? 'Depende del servicio: la app te dice antes de aceptar si es cortesía del MOPT o si lo cubre una aseguradora. En esos casos no le cobras nada al Usuario.'
    : 'Depende del servicio: la app te dice antes de aceptar si es cortesía del MOPT. En ese caso no le cobras nada al Usuario.' },
  { q: '¿Cuánto tarda la aprobación?', a: 'Revisamos tus documentos en pocos días hábiles. Si alguno está borroso o vencido, te decimos cuál y lo corriges desde tu registro.' },
  { q: '¿Qué pasa si se vence mi licencia o mi seguro?', a: 'Te avisamos 15 días antes. Si se vence, tu cuenta queda en pausa hasta que subas el documento nuevo y lo revisemos.' },
  { q: '¿Puedo registrarme sin descargar la app?', a: 'Sí. Completa el registro desde esta página; la app la necesitas para recibir y atender servicios.' },
];

export default async function PartnersLandingPage() {
  const insurers = await insurersOn();
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <BudiLogo />
            <span className="font-heading text-xl font-bold text-zinc-900 dark:text-white">Budi</span>
          </Link>
          <nav className="flex items-center gap-3">
            <Link href="/login?redirect=/socios/registro" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
              Ya tengo cuenta
            </Link>
            <Link href="/socios/registro" className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-600">
              Regístrate como socio
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-budi-primary-600 dark:text-budi-primary-400">Trabaja con Budi</p>
            <h1 className="mt-3 font-heading text-4xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-5xl">
              Tu grúa, más servicios. Sé socio operador de Budi.
            </h1>
            <p className="mt-5 text-lg text-zinc-600 dark:text-zinc-400">
              Recibe solicitudes de asistencia vial cerca de ti —grúa, batería, llanta, combustible, cerrajería, mecánica,
              winche y pipas de agua— y cobra por cada servicio que completas.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/socios/registro" className="rounded-lg bg-budi-primary-500 px-6 py-3 font-semibold text-white hover:bg-budi-primary-600">
                Regístrate como socio
              </Link>
              <a href="#pre-registro" className="rounded-lg border border-zinc-300 px-6 py-3 font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Primero quiero que me contacten
              </a>
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-200 bg-zinc-50 px-4 py-14 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {beneficios(insurers).map(({ Icon, title, text }) => (
              <div key={title} className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-budi-primary-50 text-budi-primary-600 dark:bg-budi-primary-900/40 dark:text-budi-primary-300">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="font-semibold text-zinc-900 dark:text-white">{title}</h2>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-4 py-14 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2">
            <div>
              <h2 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Cómo funciona</h2>
              <ol className="mt-6 space-y-5">
                {PASOS.map(({ Icon, title, text }, i) => (
                  <li key={title} className="flex gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-budi-primary-500 text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-zinc-900 dark:text-white">{i + 1}. {title}</p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h2 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Requisitos</h2>
              <ul className="mt-6 space-y-2">
                {REQUISITOS.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" /> {r}
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex gap-3 rounded-xl bg-budi-primary-50 p-4 text-sm text-budi-primary-900 dark:bg-budi-primary-950/40 dark:text-budi-primary-200">
                <HandCoins className="h-5 w-5 shrink-0" />
                <p>
                  <strong>Cómo te pagamos:</strong> por cada servicio completado Budi retiene una comisión acordada y te
                  liquida el resto a tu cuenta. Ves cada monto en la app antes y después de atender.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="pre-registro" className="scroll-mt-8 border-t border-zinc-200 bg-zinc-50 px-4 py-14 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">¿Quieres que te contactemos primero?</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Déjanos cinco datos y te escribimos por WhatsApp para explicarte todo y ayudarte con el registro.
            </p>
            <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
              <PartnerLeadForm />
            </div>
          </div>
        </section>

        <section className="px-4 py-14 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Preguntas frecuentes</h2>
            <div className="mt-6 divide-y divide-zinc-200 dark:divide-zinc-800">
              {preguntas(insurers).map(({ q, a }) => (
                <details key={q} className="group py-4">
                  <summary className="cursor-pointer list-none font-medium text-zinc-900 marker:hidden dark:text-white">
                    <span className="mr-2 inline-block transition group-open:rotate-90">›</span>
                    {q}
                  </summary>
                  <p className="mt-2 pl-5 text-sm text-zinc-600 dark:text-zinc-400">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 px-4 py-8 text-center text-xs text-zinc-500 dark:border-zinc-800">
        © Budi · <Link href="/privacidad" className="underline">Aviso de privacidad</Link> ·{' '}
        <Link href="/socios/contrato" className="underline">Contrato para socios</Link>
      </footer>
    </div>
  );
}
