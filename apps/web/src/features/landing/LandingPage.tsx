import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BatteryCharging,
  Building2,
  CalendarCheck,
  ClipboardList,
  Fuel,
  KeyRound,
  Landmark,
  LifeBuoy,
  Lock,
  MapPin,
  Navigation,
  ShieldCheck,
  Timer,
  Truck,
  Wrench,
} from 'lucide-react';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { insurersOn } from '@/shared/lib/insurers-public';

// Landing pública (backlog LAN-10). Página estática, sin sesión: tres públicos
// en una sola página — el Usuario (descargar la app), las instituciones (MOPT,
// aseguradoras, reaseguradoras: agendar demo) y los socios operadores (/socios).
// Aseguradoras y reaseguradoras solo con el interruptor prendido (00153).
// Reglas: tuteo, terminología del backlog §0, nunca mostrar la comisión de Budi,
// y nada de clientes, cifras ni testimonios inventados.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const DESCRIPTION_BASE =
  'Pide grúa o asistencia vial en El Salvador desde tu teléfono: sigue a tu socio operador en vivo y confirma el servicio con tu PIN de confirmación.';

function description(insurers: boolean): string {
  return `${DESCRIPTION_BASE} Soluciones para el MOPT${insurers ? ', aseguradoras y reaseguradoras' : ''}.`;
}

export async function generateMetadata(): Promise<Metadata> {
  const DESCRIPTION = description(await insurersOn());
  return {
  metadataBase: new URL(SITE_URL),
  title: { absolute: 'Budi · Grúas y asistencia vial en El Salvador' },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'es_SV',
    url: '/',
    siteName: 'Budi',
    title: 'Budi · Grúas y asistencia vial en El Salvador',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Budi · Grúas y asistencia vial en El Salvador',
    description: DESCRIPTION,
  },
  };
}

// Contacto comercial: configurable por entorno. Si no hay correo, se cae a
// WhatsApp de soporte; si tampoco, el botón se muestra como "próximamente".
const SALES_EMAIL = (process.env.NEXT_PUBLIC_SALES_EMAIL ?? '').trim();
const SUPPORT_WHATSAPP = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');
const DEMO_SUBJECT = 'Quiero agendar una demo de Budi';
function demoBody(insurers: boolean): string {
  const tipos = insurers ? 'MOPT / aseguradora / reaseguradora / otra' : 'MOPT / otra';
  return `Hola, equipo de Budi:\n\nMe interesa agendar una demo.\n\nInstitución:\nTipo (${tipos}):\nNombre y cargo:\nTeléfono:\n`;
}

function demoHref(insurers: boolean): string | null {
  if (SALES_EMAIL) {
    return `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(DEMO_SUBJECT)}&body=${encodeURIComponent(demoBody(insurers))}`;
  }
  if (SUPPORT_WHATSAPP) {
    return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(DEMO_SUBJECT)}`;
  }
  return null;
}

// Enlaces de tienda: vacíos hasta publicar (Android: com.budisv.app).
// Mientras no estén configurados se muestran como "Próximamente".
const PLAY_STORE_URL = (process.env.NEXT_PUBLIC_PLAY_STORE_URL ?? '').trim();
const APP_STORE_URL = (process.env.NEXT_PUBLIC_APP_STORE_URL ?? '').trim();

const SERVICIOS = [
  { Icon: Truck, label: 'Grúa' },
  { Icon: BatteryCharging, label: 'Batería' },
  { Icon: LifeBuoy, label: 'Cambio de llanta' },
  { Icon: Fuel, label: 'Combustible' },
  { Icon: KeyRound, label: 'Cerrajería' },
  { Icon: Wrench, label: 'Mecánica' },
];

const PASOS_USUARIO = [
  {
    Icon: MapPin,
    title: 'Pide ayuda en segundos',
    text: 'Elige el servicio, confirma tu ubicación y el destino. Ves el precio antes de confirmar y, si tienes seguro, cuánto te cubre.',
  },
  {
    Icon: Navigation,
    title: 'Síguelo en vivo',
    text: 'Ves en el mapa a tu socio operador mientras llega y puedes escribirle por el chat de la app.',
  },
  {
    Icon: ShieldCheck,
    title: 'Confirma con tu PIN',
    text: 'El servicio se cierra solo cuando le das tu PIN de confirmación al socio operador. Nadie lo marca como terminado sin ti.',
  },
];

const INSTITUCIONES = [
  {
    Icon: Landmark,
    title: 'MOPT',
    text: 'Opera un programa de asistencia vial de cortesía: casos con trazabilidad completa, tu propia flota junto a la red de socios operadores y reportes por periodo.',
  },
  {
    Icon: ShieldCheck,
    title: 'Aseguradoras',
    insurers: true,
    text: 'Carga tu padrón de asegurados, define qué cubre cada plan y sigue cada caso con folio, línea de tiempo y cumplimiento de tiempos de atención (SLA).',
  },
  {
    Icon: Building2,
    title: 'Reaseguradoras',
    insurers: true,
    text: 'Conversemos sobre cómo darte visibilidad de la operación de asistencia de las aseguradoras que respaldas.',
  },
];

const CAPACIDADES = [
  { Icon: ClipboardList, text: 'Portal web con el detalle y la línea de tiempo de cada caso' },
  { Icon: Timer, text: 'Medición de tiempos de asignación, llegada y servicio' },
  { Icon: Truck, text: 'Despacho sugerido al socio operador más cercano' },
  { Icon: Lock, text: 'Acceso por organización, con roles y verificación en dos pasos' },
];

function AppleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
      <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 01-.61-.92V2.734a1 1 0 01.609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.198l2.807 1.626a1 1 0 010 1.73l-2.808 1.626L15.206 12l2.492-2.491zM5.864 2.658L16.8 8.99l-2.302 2.302-8.634-8.634z" />
    </svg>
  );
}

function StoreBadge({ href, store, Icon }: { href: string; store: string; Icon: () => React.JSX.Element }) {
  const inner = (
    <>
      <Icon />
      <span className="flex flex-col text-left leading-tight">
        <span className="text-xs">{href ? 'Descárgala en' : 'Próximamente en'}</span>
        <span className="text-base font-semibold">{store}</span>
      </span>
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        className="inline-flex items-center gap-3 rounded-xl bg-zinc-900 px-5 py-3 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {inner}
      </a>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-3 rounded-xl border border-dashed border-zinc-400 px-5 py-3 text-zinc-700 dark:border-zinc-600 dark:text-zinc-300"
      aria-label={`${store}: próximamente`}
    >
      {inner}
    </span>
  );
}

// Tarjeta ilustrativa (decorativa) de cómo se ve un servicio en curso.
// Sin nombres, placas ni cifras: no representa un servicio real.
function ServicePreview() {
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-sm">
      <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-xl shadow-budi-primary-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-none">
        <div className="relative h-40 overflow-hidden rounded-2xl bg-budi-primary-50 dark:bg-budi-primary-900/40">
          <svg viewBox="0 0 300 160" className="h-full w-full" fill="none">
            <path d="M0 120 C60 110 90 60 150 70 S250 30 300 40" className="stroke-zinc-300 dark:stroke-zinc-600" strokeWidth="14" strokeLinecap="round" />
            <path d="M30 118 C80 104 100 66 150 70 S230 40 262 42" className="stroke-budi-primary-600 dark:stroke-budi-primary-400" strokeWidth="4" strokeDasharray="2 8" strokeLinecap="round" />
            <circle cx="262" cy="42" r="9" className="fill-budi-accent-500" />
            <circle cx="262" cy="42" r="4" className="fill-white" />
          </svg>
          <div className="absolute left-[18%] top-[62%] flex h-9 w-9 items-center justify-center rounded-full bg-budi-primary-600 text-white shadow-md">
            <Truck className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Tu socio operador va en camino</p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">Síguelo en el mapa hasta que llegue</p>
          </div>
          <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
            En ruta
          </span>
        </div>
        <div className="mt-4 rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-800">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">PIN de confirmación</p>
          <div className="mt-2 flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-300 bg-white text-lg font-bold text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-white">
                •
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Dáselo solo cuando el servicio esté completo.</p>
        </div>
      </div>
    </div>
  );
}

export default async function LandingPage() {
  const insurers = await insurersOn();
  const demo = demoHref(insurers);
  const instituciones = INSTITUCIONES.filter((i) => insurers || !('insurers' in i && i.insurers));
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-zinc-900 focus:shadow"
      >
        Saltar al contenido
      </a>

      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span aria-hidden="true">
              <BudiLogo />
            </span>
            <span className="font-heading text-xl font-bold text-zinc-900 dark:text-white">Budi</span>
          </Link>
          <nav aria-label="Principal" className="flex items-center gap-5">
            <a href="#usuarios" className="hidden text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white md:inline">
              Pide asistencia
            </a>
            <a href="#instituciones" className="hidden text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white md:inline">
              Instituciones
            </a>
            <Link href="/socios" className="hidden text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white md:inline">
              Trabaja con Budi
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              Iniciar sesión
            </Link>
          </nav>
        </div>
      </header>

      <main id="contenido" className="flex-1">
        {/* Hero */}
        <section className="bg-gradient-to-b from-budi-primary-50 to-white px-4 py-16 dark:from-budi-primary-900/30 dark:to-zinc-950 sm:px-6 lg:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-budi-primary-700 dark:text-budi-primary-300">
                Asistencia vial en El Salvador
              </p>
              <h1 className="mt-3 font-heading text-4xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-5xl">
                ¿Te quedaste varado? Pide tu grúa desde el teléfono.
              </h1>
              <p className="mt-5 text-lg text-zinc-700 dark:text-zinc-300">
                Budi te conecta con socios operadores verificados cerca de ti. Ves el precio antes de confirmar, sigues
                la grúa en vivo y cierras el servicio con tu PIN de confirmación.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#descarga"
                  className="rounded-lg bg-budi-primary-600 px-6 py-3 text-center font-semibold text-white hover:bg-budi-primary-700"
                >
                  Descarga la app
                </a>
                <a
                  href="#instituciones"
                  className="rounded-lg border border-zinc-300 bg-white px-6 py-3 text-center font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-transparent dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  Soy una institución
                </a>
              </div>
            </div>
            <ServicePreview />
          </div>
        </section>

        {/* Usuario */}
        <section id="usuarios" aria-labelledby="usuarios-titulo" className="scroll-mt-4 px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 id="usuarios-titulo" className="font-heading text-3xl font-bold text-zinc-900 dark:text-white">
              Asistencia cuando la necesitas
            </h2>
            <p className="mt-3 max-w-2xl text-zinc-700 dark:text-zinc-300">
              Sin llamadas ni esperas a ciegas: todo el servicio pasa por la app, de principio a fin.
            </p>

            <ol className="mt-10 grid gap-6 md:grid-cols-3">
              {PASOS_USUARIO.map(({ Icon, title, text }, i) => (
                <li key={title} className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-budi-primary-600 text-white">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">Paso {i + 1}</span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-white">{title}</h3>
                  <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{text}</p>
                </li>
              ))}
            </ol>

            <h3 className="mt-12 text-lg font-semibold text-zinc-900 dark:text-white">Servicios que puedes pedir</h3>
            <ul className="mt-4 flex flex-wrap gap-3">
              {SERVICIOS.map(({ Icon, label }) => (
                <li
                  key={label}
                  className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <Icon aria-hidden="true" className="h-4 w-4 text-budi-primary-700 dark:text-budi-primary-300" />
                  {label}
                </li>
              ))}
            </ul>

            <div
              id="descarga"
              className="mt-12 scroll-mt-4 rounded-2xl bg-budi-primary-50 p-6 dark:bg-budi-primary-900/30 sm:p-8"
            >
              <h3 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Descarga la app de Budi</h3>
              <p className="mt-2 text-zinc-700 dark:text-zinc-300">
                Para Android y iPhone. Crea tu cuenta, guarda tus datos y pide asistencia cuando la necesites.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <StoreBadge href={PLAY_STORE_URL} store="Google Play" Icon={PlayIcon} />
                <StoreBadge href={APP_STORE_URL} store="App Store" Icon={AppleIcon} />
              </div>
            </div>
          </div>
        </section>

        {/* Instituciones */}
        <section
          id="instituciones"
          aria-labelledby="instituciones-titulo"
          className="scroll-mt-4 border-t border-zinc-200 bg-zinc-50 px-4 py-16 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6"
        >
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-budi-primary-700 dark:text-budi-primary-300">
              Para instituciones
            </p>
            <h2 id="instituciones-titulo" className="mt-2 font-heading text-3xl font-bold text-zinc-900 dark:text-white">
              Tu programa de asistencia vial, operado y medido
            </h2>
            <p className="mt-3 max-w-2xl text-zinc-700 dark:text-zinc-300">
              Budi pone la red de socios operadores, la app para tus Usuarios y un portal donde ves cada caso con datos
              verificables.
            </p>

            <div className={`mt-10 grid gap-6 ${instituciones.length > 1 ? 'md:grid-cols-3' : 'max-w-xl'}`}>
              {instituciones.map(({ Icon, title, text }) => (
                <article key={title} className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-budi-primary-100 text-budi-primary-700 dark:bg-budi-primary-900/60 dark:text-budi-primary-200">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-white">{title}</h3>
                  <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{text}</p>
                </article>
              ))}
            </div>

            <div className="mt-10 grid items-center gap-8 lg:grid-cols-[1fr_auto]">
              <ul className="grid gap-3 sm:grid-cols-2">
                {CAPACIDADES.map(({ Icon, text }) => (
                  <li key={text} className="flex items-start gap-3 text-sm text-zinc-800 dark:text-zinc-200">
                    <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-budi-primary-700 dark:text-budi-primary-300" />
                    {text}
                  </li>
                ))}
              </ul>
              <div className="flex flex-col items-start gap-2 lg:items-end">
                {demo ? (
                  <a
                    href={demo}
                    className="inline-flex items-center gap-2 rounded-lg bg-budi-primary-600 px-6 py-3 font-semibold text-white hover:bg-budi-primary-700"
                  >
                    <CalendarCheck aria-hidden="true" className="h-5 w-5" />
                    Agenda una demo
                  </a>
                ) : (
                  <>
                    <span
                      aria-disabled="true"
                      className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-zinc-200 px-6 py-3 font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      <CalendarCheck aria-hidden="true" className="h-5 w-5" />
                      Agenda una demo
                    </span>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                      Muy pronto habilitaremos el contacto comercial.
                    </p>
                  </>
                )}
                {SALES_EMAIL && (
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    o escríbenos a{' '}
                    <a href={`mailto:${SALES_EMAIL}`} className="font-medium text-budi-primary-700 underline dark:text-budi-primary-300">
                      {SALES_EMAIL}
                    </a>
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Socios */}
        <section id="socios" aria-labelledby="socios-titulo" className="px-4 py-16 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 rounded-3xl bg-zinc-900 p-8 text-white dark:bg-zinc-800 sm:p-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-wide text-budi-accent-300">Trabaja con Budi</p>
              <h2 id="socios-titulo" className="mt-2 font-heading text-3xl font-bold">
                ¿Tienes grúa o vehículo de asistencia? Sé socio operador.
              </h2>
              <p className="mt-3 text-zinc-300">
                Recibe solicitudes cerca de ti, conéctate cuando quieras trabajar y ve en la app lo que cobras por cada
                servicio. Atiende a particulares{insurers ? ', afiliados de aseguradoras' : ''} y el programa del MOPT.
              </p>
            </div>
            <Link
              href="/socios"
              className="shrink-0 rounded-lg bg-budi-accent-300 px-6 py-3 text-center font-semibold text-zinc-900 hover:bg-budi-accent-200"
            >
              Conoce cómo ser socio
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <span aria-hidden="true">
              <BudiLogo size={24} />
            </span>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">© {year} Budi · Asistencia vial en El Salvador</p>
          </div>
          <nav aria-label="Pie de página">
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <li>
                <Link href="/privacidad" className="text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-300">
                  Aviso de privacidad
                </Link>
              </li>
              <li>
                <Link href="/eliminar-cuenta" className="text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-300">
                  Eliminar mi cuenta
                </Link>
              </li>
              <li>
                <Link href="/socios" className="text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-300">
                  Trabaja con Budi
                </Link>
              </li>
              <li>
                <Link href="/login" className="text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-300">
                  Iniciar sesión
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
