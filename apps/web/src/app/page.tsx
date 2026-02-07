import Link from "next/link";
import { MapPin, DollarSign, MessageCircle, ClipboardList } from "lucide-react";
import { BudiLogo } from "@/components/BudiLogo";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <BudiLogo />
            <span className="font-heading text-xl font-bold text-zinc-900 dark:text-white">
              Budi
            </span>
          </div>
          <nav className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            >
              Iniciar Sesion
            </Link>
            <Link
              href="/admin"
              className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600"
            >
              Admin Portal
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex flex-1 flex-col">
        <section className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="font-heading text-4xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-6xl">
              Asistencia vehicular
              <span className="text-budi-accent-400"> inteligente</span>
            </h1>
            <p className="mt-6 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
              Plataforma integral para solicitar servicios de asistencia
              vehicular, con asignacion por zona usando GPS en tiempo real,
              seguimiento en mapa, y sistema de precios dinamico.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/admin"
                className="w-full rounded-lg bg-budi-primary-500 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-budi-primary-600 sm:w-auto"
              >
                Portal Administrativo
              </Link>
              <Link
                href="/mop"
                className="w-full rounded-lg border border-zinc-300 bg-white px-6 py-3 text-base font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800 sm:w-auto"
              >
                Portal MOP
              </Link>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="border-t border-zinc-200 bg-zinc-50 px-4 py-16 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <h2 className="font-heading text-center text-2xl font-bold text-zinc-900 dark:text-white">
              Funcionalidades del Sistema
            </h2>
            <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-budi-primary-100 text-budi-primary-500 dark:bg-budi-primary-900 dark:text-budi-primary-400">
                    {feature.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Roles Section */}
        <section className="px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <h2 className="font-heading text-center text-2xl font-bold text-zinc-900 dark:text-white">
              Roles del Sistema
            </h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {roles.map((role) => (
                <div
                  key={role.title}
                  className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-700"
                >
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                    {role.title}
                  </h3>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {role.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            Budi - Asistencia Vehicular - MVP v0.1.0
          </p>
        </div>
      </footer>
    </div>
  );
}

const features = [
  {
    title: "GPS en Tiempo Real",
    description:
      "Seguimiento en vivo de la ubicacion del servicio desde la solicitud hasta la entrega.",
    icon: <MapPin className="h-6 w-6" />,
  },
  {
    title: "Precios Dinamicos",
    description:
      "Sistema de tarifas parametrizables con calculo automatico basado en distancia y tipo de servicio.",
    icon: <DollarSign className="h-6 w-6" />,
  },
  {
    title: "Chat Integrado",
    description:
      "Comunicacion directa entre usuario y operador para coordinar el servicio.",
    icon: <MessageCircle className="h-6 w-6" />,
  },
  {
    title: "Auditoria Completa",
    description:
      "Registro de todos los eventos del servicio para trazabilidad y control.",
    icon: <ClipboardList className="h-6 w-6" />,
  },
];

const roles = [
  {
    title: "Usuario Final",
    description:
      "Solicita servicios de asistencia, sube documentos, hace seguimiento en tiempo real y califica el servicio.",
  },
  {
    title: "Operador",
    description:
      "Recibe solicitudes por zona, acepta servicios, actualiza estados y se comunica con el usuario.",
  },
  {
    title: "Administrador",
    description:
      "Gestiona proveedores, configura precios, supervisa operaciones y genera reportes.",
  },
  {
    title: "MOP",
    description:
      "Visualiza estadisticas de servicios y recibe notificaciones informativas via WhatsApp.",
  },
];
