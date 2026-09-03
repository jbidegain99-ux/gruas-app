// Aviso de privacidad publico (Decreto 144, art. sobre aviso detallado).
// Server component: es contenido estatico, no necesita 'use client'.
//
// El contenido sigue docs/PROTECCION_DATOS.md — si cambia uno, actualizar el
// otro. Los datos que solo Walter puede completar (razon social, NIT, DPO,
// dominio del correo) estan marcados con <Pendiente> para que sean imposibles
// de pasar por alto en la revision: es preferible un hueco visible a un dato
// inventado en un documento legal.

import Link from 'next/link';
import { BudiLogo } from '@/shared/components/BudiLogo';

const ACTUALIZADO = '26 de agosto de 2026';

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
        <p className="mt-1 text-sm text-zinc-500">Ultima actualizacion: {ACTUALIZADO}</p>

        <Seccion titulo="1. Quien trata tus datos">
          <p>
            El responsable del tratamiento es <Pendiente>razon social</Pendiente>, con NIT{' '}
            <Pendiente>NIT</Pendiente> y domicilio en <Pendiente>direccion</Pendiente>, que opera
            la plataforma de asistencia vial <strong>Budi</strong> en El Salvador.
          </p>
          <p>
            Nuestro Delegado de Proteccion de Datos es <Pendiente>nombre del DPO</Pendiente> y
            podes contactarlo en <Pendiente>privacidad@dominio</Pendiente>.
          </p>
        </Seccion>

        <Seccion titulo="2. Que datos tratamos">
          <p>Segun tu rol en la plataforma:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Si sos usuario:</strong> nombre, telefono, correo, datos de tu vehiculo
              (placa, marca, modelo, color), direcciones y coordenadas de recogida y destino, tu
              ubicacion durante el servicio, los mensajes del chat con el operador y las
              calificaciones que dejas.
            </li>
            <li>
              <strong>Si sos operador:</strong> ademas de lo anterior, tu numero de DUI y las
              imagenes de tu DUI, licencia de conducir y tarjeta de circulacion, y tu{' '}
              <strong>ubicacion mientras estas en linea</strong>, incluso con la aplicacion en
              segundo plano.
            </li>
          </ul>
        </Seccion>

        <Seccion titulo="3. Para que los usamos y con que base legal">
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
                  <td className="py-2">Ejecucion del contrato</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Asignar operador y mostrar el seguimiento en vivo</td>
                  <td className="py-2">Ejecucion del contrato</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Verificar que el operador puede ejercer</td>
                  <td className="py-2">Obligacion legal e interes legitimo</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Seguridad y resolucion de disputas</td>
                  <td className="py-2">Interes legitimo</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Notificaciones operativas del servicio</td>
                  <td className="py-2">Ejecucion del contrato</td>
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

        <Seccion titulo="4. Con quien los compartimos">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Con el operador que te atiende:</strong> tu nombre, telefono y la ubicacion
              de recogida. Solo mientras el servicio esta en curso.
            </li>
            <li>
              <strong>Con proveedores de infraestructura</strong> que alojan la plataforma y
              envian las notificaciones.
            </li>
            <li>
              <strong>Con autoridades</strong> cuando exista requerimiento legal.
            </li>
          </ul>
          <p>No vendemos tus datos personales ni los cedemos con fines publicitarios de terceros.</p>
        </Seccion>

        <Seccion titulo="5. Cuanto tiempo los conservamos">
          <ul className="list-disc space-y-1 pl-5">
            <li>Cuenta y perfil: mientras la cuenta este activa y hasta 12 meses despues de la baja.</li>
            <li>Servicios y facturacion: <Pendiente>plazo por confirmar</Pendiente>.</li>
            <li>Recorrido detallado de cada servicio: 90 dias.</li>
            <li>Mensajes del chat: 12 meses.</li>
            <li>Documentos de identidad del operador: mientras este activo y hasta 12 meses despues.</li>
          </ul>
        </Seccion>

        <Seccion titulo="6. Tus derechos">
          <p>
            Podes <strong>acceder</strong> a tus datos, <strong>rectificarlos</strong>,{' '}
            <strong>cancelarlos</strong>, <strong>oponerte</strong> a su tratamiento,{' '}
            <strong>portarlos</strong> a otro responsable, pedir su <strong>olvido</strong> en
            entornos digitales o <strong>limitar</strong> temporalmente su uso.
          </p>
          <p>
            Escribi a <Pendiente>privacidad@dominio</Pendiente> acreditando tu identidad.
            Responderemos de forma gratuita en un plazo maximo de{' '}
            <strong>20 dias habiles</strong>.
          </p>
          <p>
            Si consideras que no atendimos tu solicitud, podes reclamar ante la{' '}
            <strong>Agencia de Ciberseguridad del Estado (ACE)</strong>.
          </p>
        </Seccion>

        <Seccion titulo="7. Seguridad">
          <p>
            Aplicamos medidas tecnicas y organizativas para proteger tus datos: el acceso a cada
            registro esta restringido por rol a nivel de base de datos, los documentos de
            identidad se guardan en almacenamiento privado y se acceden mediante enlaces
            temporales, y las comunicaciones viajan cifradas.
          </p>
          <p>
            Ante una brecha de seguridad, notificaremos a la ACE, a la Fiscalia General de la
            Republica y a las personas afectadas dentro de las <strong>72 horas</strong>{' '}
            siguientes a su deteccion.
          </p>
        </Seccion>

        <Seccion titulo="8. Cambios a este aviso">
          <p>
            Si modificamos este aviso publicaremos la nueva version en esta pagina con su fecha
            de actualizacion y, cuando el cambio sea sustancial, te lo notificaremos en la
            aplicacion.
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
