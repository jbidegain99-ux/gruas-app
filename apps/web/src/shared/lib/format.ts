// Formateo consistente para el panel de administración (locale El Salvador).
// Antes cada página formateaba a mano: unas con `money()` (dos copias), otras
// con `$${n}` crudo sin decimales, y fechas mezclando es-ES / es-SV.

const LOCALE = 'es-SV';

/** Monto en USD con separadores y 2 decimales. Ej: money(1234.5) → "$1,234.50". */
export function money(n: number | null | undefined): string {
  const value = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return `$${value.toLocaleString(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Fecha corta legible. Ej: "24 jul 2026". */
export function formatDate(
  date: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
): string {
  if (!date) return '—';
  // Una fecha sin hora ('2026-01-01', como las columnas DATE de Postgres) la
  // interpreta `new Date` como medianoche UTC; al formatearla en El Salvador
  // (UTC-6) cae al dia anterior y una poliza que arranca el 1 de enero se
  // mostraba como "31 dic". Agregarle la hora la ancla a la zona local.
  const d =
    typeof date === 'string'
      ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00` : date)
      : date;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, options);
}

/** Fecha y hora cortas, en hora de El Salvador. Ej: "28 sept, 15:04". */
export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/El_Salvador',
  });
}

/** Duración legible desde minutos: 8 min · 1 h 5 min · 2 d 3 h. */
export function duration(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round(minutes - h * 60);
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h === 0 ? `${d} d` : `${d} d ${h} h`;
}
