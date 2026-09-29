// Helpers de la ficha 360 y del dashboard de negocio (migr. 00105). Separados
// de las páginas para poder probarlos sin montar React.

export type AccountKind = 'provider' | 'insurer' | 'mopt';

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  provider: 'Empresa proveedora',
  insurer: 'Aseguradora',
  mopt: 'Programa MOPT',
};

export function isAccountKind(v: string): v is AccountKind {
  return v === 'provider' || v === 'insurer' || v === 'mopt';
}

/** La URL de la ficha. Una sola definición: todos los enlaces pasan por acá. */
export function accountUrl(kind: AccountKind, id: string): string {
  return `/admin/cuentas/${kind}/${id}`;
}

/**
 * El libro (00099) nombra a las partes por su tipo; solo estas tres tienen ficha.
 * 'operator' y 'budi' no.
 */
export function ledgerPartyUrl(kind: string, id: string | null): string | null {
  return id && isAccountKind(kind) ? accountUrl(kind, id) : null;
}

export type PeriodKey = 'month' | '30d' | '90d' | 'year';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  month: 'Este mes',
  '30d': 'Últimos 30 días',
  '90d': 'Últimos 90 días',
  year: 'Este año',
};

/** Hoy en El Salvador (YYYY-MM-DD). */
export function todaySV(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(now);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Rango [desde, hasta] en días de El Salvador, ambos inclusive. */
export function periodRange(key: PeriodKey, now: Date = new Date()): { from: string; to: string } {
  const to = todaySV(now);
  switch (key) {
    case 'month':
      return { from: `${to.slice(0, 7)}-01`, to };
    case '30d':
      return { from: addDays(to, -29), to };
    case '90d':
      return { from: addDays(to, -89), to };
    case 'year':
      return { from: `${to.slice(0, 4)}-01-01`, to };
  }
}

/** "sep" / "sep 2026" para el eje de meses. `month` viene como YYYY-MM-01. */
export function monthLabel(month: string, withYear = false): string {
  return new Intl.DateTimeFormat('es-SV', {
    timeZone: 'UTC',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  })
    .format(new Date(`${month.slice(0, 10)}T12:00:00Z`))
    .replace('.', '');
}

/** Variación porcentual entre dos meses; null si no hay base (no inventar "+100%"). */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Porcentaje que puede no existir (sin servicios medibles): "—", nunca "0%". */
export function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${Number(v)}%`;
}
