/**
 * Ganancias del operador por periodo.
 *
 * Lo que se muestra es lo que va a COBRAR, no el bruto del servicio: desde
 * 00079/00080 Budi retiene una comision, y sumar `total_price` le prometia al
 * operador un numero mas alto que el de la transferencia (medido: $357.50 en
 * pantalla contra $286.00 liquidados).
 *
 * El calculo no se replica aca: lo hace `my_operator_earnings`, la misma
 * formula que usa la liquidacion del admin (misma precedencia de comision,
 * mismo redondeo por servicio, mismo corte en hora de El Salvador). Asi la
 * pantalla del operador y la del admin no pueden discrepar.
 */
import { supabase } from '@/lib/supabase';

export type Periodo = {
  servicios: number;
  /** Lo que se le facturo al cliente. */
  bruto: number;
  /** Lo que retiene Budi. */
  comision: number;
  /**
   * El porcentaje retenido, o null si en el periodo rigieron tasas distintas
   * (las tarifas son versionadas, 00102): un solo numero no explicaria la
   * comision sumada. En ese caso se muestra solo el monto.
   */
  comisionPct: number | null;
  /** Lo que se le transfiere al operador. Es el numero que importa. */
  aCobrar: number;
};

export type EarningsSummary = { hoy: Periodo; semana: Periodo };

const PERIODO_VACIO: Periodo = { servicios: 0, bruto: 0, comision: 0, comisionPct: 0, aCobrar: 0 };
export const EMPTY_EARNINGS: EarningsSummary = { hoy: PERIODO_VACIO, semana: PERIODO_VACIO };

/**
 * La fecha de hoy en El Salvador, como `YYYY-MM-DD`.
 *
 * No sirve la fecha del dispositivo: un telefono en otra zona (o el navegador
 * en UTC durante las pruebas) corria el corte del dia y "hoy" mostraba los
 * servicios de ayer. El backend corta con `sv_day_start`, asi que el rango se
 * arma con la misma nocion de dia.
 */
export function hoySV(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(new Date());
}

/** El lunes de la semana en curso, en hora de El Salvador. */
export function lunesSV(): string {
  const hoy = new Date(hoySV() + 'T12:00:00Z');
  hoy.setUTCDate(hoy.getUTCDate() - ((hoy.getUTCDay() + 6) % 7));
  return hoy.toISOString().slice(0, 10);
}

async function periodo(desde: string, hasta: string): Promise<Periodo> {
  const { data, error } = await supabase.rpc('my_operator_earnings', {
    p_from: desde,
    p_to: hasta,
  });
  const fila = Array.isArray(data) ? data[0] : data;
  if (error || !fila) return PERIODO_VACIO;
  return {
    servicios: Number(fila.servicios) || 0,
    bruto: Number(fila.bruto) || 0,
    comision: Number(fila.comision) || 0,
    comisionPct: fila.comision_pct == null ? null : Number(fila.comision_pct),
    aCobrar: Number(fila.a_pagar) || 0,
  };
}

/** Lo facturado y lo que se cobra, hoy y en la semana en curso. */
export async function fetchOperatorEarnings(): Promise<EarningsSummary> {
  const hoy = hoySV();
  const [h, s] = await Promise.all([periodo(hoy, hoy), periodo(lunesSV(), hoy)]);
  return { hoy: h, semana: s };
}

/** Todo lo cobrado desde siempre, para el resumen del historial. */
export async function fetchOperatorTotal(): Promise<Periodo> {
  return periodo('2000-01-01', hoySV());
}

/** Lo que le queda al operador de UN servicio, con la tasa que regia cuando se completo. */
export type LineaServicio = { comisionPct: number; aCobrar: number };

/**
 * Neto por servicio. Antes se repartia cada linea con el porcentaje del total,
 * que da mal en cuanto dos servicios tienen tasas distintas (un cambio de
 * tarifa, o un servicio del MOPT, que no paga comision).
 */
export async function fetchServiceEarnings(ids: string[]): Promise<Map<string, LineaServicio>> {
  const lineas = new Map<string, LineaServicio>();
  if (ids.length === 0) return lineas;
  const { data, error } = await supabase.rpc('my_operator_service_earnings', { p_request_ids: ids });
  if (error || !data) return lineas;
  for (const f of data) {
    lineas.set(f.request_id, { comisionPct: Number(f.comision_pct), aCobrar: Number(f.a_cobrar) });
  }
  return lineas;
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}
