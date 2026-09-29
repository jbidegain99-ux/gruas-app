// Formato de la pantalla de Tarifas (migr. 00102). Separado de la página para
// poder probarlo sin montar React.

export type RateKind = 'platform_default' | 'provider' | 'operator' | 'mopt_fee';

export const RATE_KIND_LABELS: Record<RateKind, string> = {
  platform_default: 'Default de plataforma',
  provider: 'Comisión de empresa',
  operator: 'Comisión de socio operador independiente',
  mopt_fee: 'Tarifa de programa MOPT',
};

/** Una tasa NULL en la historia significa "volvió al default" (solo empresa/operador). */
export function formatRate(rate: number | null, kind: RateKind): string {
  if (rate == null) return kind === 'mopt_fee' ? '0%' : 'Default';
  return `${Number(rate)}%`;
}

/**
 * Fecha de inicio de una version, como día de El Salvador. Un cambio programado
 * empieza a las 00:00 de SV, que en UTC es 06:00: formatear en la zona del
 * navegador o en UTC podía mostrar el día anterior.
 */
export function formatValidFrom(iso: string): string {
  if (iso === '-infinity') return 'inicio';
  return new Intl.DateTimeFormat('es-SV', {
    timeZone: 'America/El_Salvador',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Hoy en El Salvador (YYYY-MM-DD): el mínimo del selector de fecha. */
export function hoySV(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(now);
}
