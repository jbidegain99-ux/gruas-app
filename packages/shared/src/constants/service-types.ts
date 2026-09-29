import type { ServiceType } from '../types/enums';

export interface ServiceTypeConfig {
  type: ServiceType;
  emoji: string;
  name: string;
  color: string;
}

export const SERVICE_TYPE_CONFIGS: Record<ServiceType, ServiceTypeConfig> = {
  tow:       { type: 'tow',       emoji: '🚛', name: 'Grúa',        color: '#E67E22' },
  battery:   { type: 'battery',   emoji: '🔋', name: 'Batería',     color: '#2ECC71' },
  tire:      { type: 'tire',      emoji: '🛞', name: 'Llanta',      color: '#3498DB' },
  fuel:      { type: 'fuel',      emoji: '⛽', name: 'Combustible', color: '#E74C3C' },
  locksmith: { type: 'locksmith', emoji: '🔑', name: 'Cerrajería',  color: '#9B59B6' },
  mechanic:  { type: 'mechanic',  emoji: '🔧', name: 'Mecánico',    color: '#F39C12' },
  winch:     { type: 'winch',     emoji: '🏗️', name: 'Winche',      color: '#1ABC9C' },
  // SRV-01 (migr. 00108): la pipa va a la ubicación del Usuario, sin destino.
  water_truck: { type: 'water_truck', emoji: '💧', name: 'Pipa de agua', color: '#2E86C1' },
};

/**
 * Respaldo mientras el catalogo no esta cargado.
 *
 * Espeja la semilla de la base, NO lo que hacia el codigo antes: hasta ahora
 * esto devolvia true solo para 'tow', mientras la base marcaba tambien el
 * winche. El respaldo se alinea con la base para que el comportamiento sea el
 * mismo se haya cargado el catalogo o no; si se hubiera dejado como estaba, un
 * winche mostraria destino o no segun si la consulta llego a tiempo.
 */
const DESTINO_POR_DEFECTO: Record<string, boolean> = {
  tow: true,
  winch: true,
  battery: false,
  tire: false,
  fuel: false,
  locksmith: false,
  mechanic: false,
  water_truck: false,
};

/**
 * Catalogo vivo, cargado desde `services.requires_destination` — la tabla que el
 * admin edita en /admin/services.
 *
 * Es estado mutable de modulo a proposito. La alternativa —volver
 * `requiresDropoff` asincrono o pasarle el catalogo— obligaria a tocar las 24
 * llamadas, casi todas dentro de renders y de guards de mapa. Esto es una tabla
 * de consulta chica que el admin edita muy de vez en cuando: se carga una vez al
 * arrancar y se lee sincronicamente.
 */
let catalogo: Record<string, boolean> | null = null;

/**
 * Alimenta el catalogo con filas de `services`. Idempotente: la
 * ultima llamada gana. Si `rows` viene vacio no se pisa lo que ya habia — una
 * consulta que fallo no debe degradar a la app al respaldo.
 */
export function setDropoffCatalog(
  rows: { service_type: string; requires_destination: boolean }[] | null | undefined
): void {
  if (!rows || rows.length === 0) return;
  const siguiente: Record<string, boolean> = {};
  for (const r of rows) siguiente[r.service_type] = !!r.requires_destination;
  catalogo = siguiente;
}

/** Solo para tests: vuelve al respaldo. */
export function resetDropoffCatalog(): void {
  catalogo = null;
}

/**
 * ¿Este servicio traslada el vehiculo y por lo tanto tiene un destino real?
 *
 * La fuente de verdad es `services.requires_destination`, que el admin edita en
 * /admin/services. Antes esto estaba hardcodeado a `tipo === 'tow'` y contradecia
 * a la base, que ya marcaba tambien el winche.
 *
 * Importa porque las columnas `dropoff_*` de `service_requests` son NOT NULL: al
 * crear una solicitud sin destino se copia el origen (ver `(user)/request.tsx`).
 * La UI no puede fiarse de que `dropoff_address` exista — tiene que preguntar
 * por aca antes de pintar "Destino", o muestra la recogida repetida.
 *
 * `service_type` puede venir null en solicitudes viejas (previas a la columna);
 * esas eran todas gruas, de ahi el fallback a 'tow'.
 */
export function requiresDropoff(type: ServiceType | string | null | undefined): boolean {
  const clave = type ?? 'tow';
  const fuente = catalogo ?? DESTINO_POR_DEFECTO;
  // Un tipo que no esta en el catalogo (creado despues de cargarlo) cae al
  // respaldo, y si tampoco esta ahi se asume que no traslada: es la opcion
  // conservadora, porque pintar un destino inexistente es peor que omitirlo.
  return fuente[clave] ?? DESTINO_POR_DEFECTO[clave] ?? false;
}
