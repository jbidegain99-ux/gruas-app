// Aviso de privacidad público (Decreto 144, art. sobre aviso detallado).
// Server component: es contenido estático, no necesita 'use client'.
//
// El contenido sigue docs/PROTECCION_DATOS.md — si cambia uno, actualizar el
// otro. Los datos que solo Walter puede completar (razón social, NIT, DPO,
// dominio del correo) están marcados con <Pendiente> para que sean imposibles
// de pasar por alto en la revisión: es preferible un hueco visible a un dato
// inventado en un documento legal.

import Link from 'next/link';
import { BudiLogo } from '@/shared/components/BudiLogo';

const ACTUALIZADO = '25 de septiembre de 2026';

function Pendiente({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      [{children}]
    </mark>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">{titulo}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="inline-block">
          <BudiLogo />
        </Link>

        <h1 className="mt-6 text-2xl font-bold text-zinc-900 dark:text-white">
          Aviso de privacidad
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Última actualización: {ACTUALIZADO}</p>

        <Seccion titulo="1. Quién trata tus datos">
          <p>
            El responsable del tratamiento es <Pendiente>razón social</Pendiente>, con NIT{' '}
            <Pendiente>NIT</Pendiente> y domicilio en <Pendiente>dirección</Pendiente>, que opera
            la plataforma de asistencia vial <strong>Budi</strong> en El Salvador.
          </p>
          <p>
            Nuestro Delegado de Protección de Datos es <Pendiente>nombre del DPO</Pendiente> y
            puedes contactarlo en <Pendiente>privacidad@dominio</Pendiente>.
          </p>
        </Seccion>

        <Seccion titulo="2. Qué datos tratamos">
          <p>Según tu rol en la plataforma:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Si eres Usuario:</strong> nombre, teléfono, correo, datos de tu vehículo
              (placa, marca, modelo, color), direcciones y coordenadas de recogida y destino, tu
              ubicación durante el servicio, los mensajes del chat con el socio operador y las
              calificaciones que dejas.
            </li>
            <li>
              <strong>Si eres socio operador:</strong> además de lo anterior, tu número de DUI y de NIT, las
              imágenes de tu DUI, NIT, licencia de conducir, tarjeta de circulación, seguro y de tu unidad, las
              fechas de vencimiento de esos documentos, la cuenta bancaria donde te pagamos, y tu{' '}
              <strong>ubicación mientras estás en línea</strong>, incluso con la aplicación en
              segundo plano.
            </li>
            <li>
              <strong>Si te pre-registras como socio en /socios:</strong> nombre, teléfono, correo (opcional),
              zona, tipo de vehículo y servicios que ofreces, para contactarte sobre tu registro.
            </li>
          </ul>
        </Seccion>

        <Seccion titulo="3. Para qué los usamos y con qué base legal">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-700">
                <tr>
                  <th className="py-2 pr-4">Finalidad</th>
                  <th className="py-2">Base legal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                <tr>
                  <td className="py-2 pr-4">Prestarte el servicio de asistencia solicitado</td>
                  <td className="py-2">Ejecución del contrato</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Asignar socio operador y mostrar el seguimiento en vivo</td>
                  <td className="py-2">Ejecución del contrato</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Verificar que el socio operador puede ejercer</td>
                  <td className="py-2">Obligación legal e interés legítimo</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Seguridad y resolución de disputas</td>
                  <td className="py-2">Interés legítimo</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Notificaciones operativas del servicio</td>
                  <td className="py-2">Ejecución del contrato</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Promociones y novedades</td>
                  <td className="py-2">Tu consentimiento (opcional y revocable)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Solo las comunicaciones comerciales dependen de tu consentimiento. El resto es
            necesario para prestarte el servicio: si te opones a ese tratamiento, no podemos
            operar tu solicitud.
          </p>
        </Seccion>

        <Seccion titulo="4. Con quién los compartimos">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Con el socio operador que te atiende:</strong> tu nombre, teléfono y la ubicación
              de recogida. Solo mientras el servicio está en curso.
            </li>
            <li>
              <strong>Con tu aseguradora</strong>, si tu póliza cubre el servicio: el folio, el tipo
              de servicio, los lugares, los tiempos de atención y los montos que le corresponden.
            </li>
            <li>
              <strong>Con el programa de asistencia vial del MOPT</strong>, si ese programa cubre tu
              servicio: tu nombre, la placa y los datos de tu vehículo, los lugares y el recorrido
              del socio operador. Lo necesita porque su flota te atiende y rinde cuentas del servicio. No
              recibe tu teléfono ni tu DUI.
            </li>
            <li>
              <strong>Con proveedores de infraestructura</strong> que alojan la plataforma y
              envían las notificaciones.
            </li>
            <li>
              <strong>Con autoridades</strong> cuando exista requerimiento legal.
            </li>
          </ul>
          <p>No vendemos tus datos personales ni los cedemos con fines publicitarios de terceros.</p>
        </Seccion>

        <Seccion titulo="5. Cuánto tiempo los conservamos">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Cuenta y perfil: mientras la cuenta esté activa. Si la eliminas, tus datos personales se
              borran de inmediato; los servicios ya prestados se conservan sin tus datos, como registro
              contable.
            </li>
            <li>Servicios y facturación: <Pendiente>plazo por confirmar</Pendiente>.</li>
            <li>Recorrido detallado de cada servicio: 90 días.</li>
            <li>Mensajes del chat: 12 meses.</li>
            <li>Pre-registros de socios que no completaron su registro: 12 meses.</li>
            <li>Documentos de identidad del socio operador: mientras esté activo y hasta 12 meses después.</li>
          </ul>
        </Seccion>

        <Seccion titulo="6. Tus derechos">
          <p>
            Puedes <strong>acceder</strong> a tus datos, <strong>rectificarlos</strong>,{' '}
            <strong>cancelarlos</strong>, <strong>oponerte</strong> a su tratamiento,{' '}
            <strong>portarlos</strong> a otro responsable, pedir su <strong>olvido</strong> en
            entornos digitales o <strong>limitar</strong> temporalmente su uso.
          </p>
          <p>
            Puedes <strong>eliminar tu cuenta</strong> tú mismo desde la app (Perfil → Eliminar mi
            cuenta) o desde <Link href="/eliminar-cuenta" className="text-budi-primary-600 underline">esta
            página</Link>.
          </p>
          <p>
            Para los demás derechos, escribe a <Pendiente>privacidad@dominio</Pendiente> acreditando tu identidad.
            Responderemos de forma gratuita en un plazo máximo de{' '}
            <strong>20 días hábiles</strong>.
          </p>
          <p>
            Si consideras que no atendimos tu solicitud, puedes reclamar ante la{' '}
            <strong>Agencia de Ciberseguridad del Estado (ACE)</strong>.
          </p>
        </Seccion>

        <Seccion titulo="7. Seguridad">
          <p>
            Aplicamos medidas técnicas y organizativas para proteger tus datos: el acceso a cada
            registro está restringido por rol a nivel de base de datos, los documentos de
            identidad se guardan en almacenamiento privado y se acceden mediante enlaces
            temporales, y las comunicaciones viajan cifradas.
          </p>
          <p>
            Ante una brecha de seguridad, notificaremos a la ACE, a la Fiscalía General de la
            República y a las personas afectadas dentro de las <strong>72 horas</strong>{' '}
            siguientes a su detección.
          </p>
        </Seccion>

        <Seccion titulo="8. Cambios a este aviso">
          <p>
            Si modificamos este aviso publicaremos la nueva versión en esta página con su fecha
            de actualización y, cuando el cambio sea sustancial, te lo notificaremos en la
            aplicación.
          </p>
        </Seccion>

        <p className="mt-10 text-sm">
          <Link href="/" className="font-medium text-budi-primary-500 hover:underline">
            Volver al inicio
          </Link>
        </p>
      </div>
    </div>
  );
}
