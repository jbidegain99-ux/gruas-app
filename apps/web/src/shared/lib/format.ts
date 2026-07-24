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
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, options);
}
