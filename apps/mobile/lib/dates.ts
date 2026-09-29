// Formato de fechas de la app: siempre en español de El Salvador y en la hora
// de El Salvador, sin importar la zona horaria configurada en el teléfono
// (un socio o un Usuario con el teléfono en otra zona veía horas corridas).

export const APP_LOCALE = 'es-SV';
export const APP_TIME_ZONE = 'America/El_Salvador';

type DateInput = string | number | Date;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Formatea con Intl en es-SV y zona America/El_Salvador. */
export function formatDateTime(value: DateInput, options: Intl.DateTimeFormatOptions): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(APP_LOCALE, { ...options, timeZone: APP_TIME_ZONE }).format(date);
}

/** Fecha corta: 28 sept 2026. */
export function formatDate(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  return formatDateTime(value, options ?? { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Hora: 14:05 (o 2:05 p. m., según la configuración regional). */
export function formatTime(value: DateInput): string {
  return formatDateTime(value, { hour: '2-digit', minute: '2-digit' });
}
