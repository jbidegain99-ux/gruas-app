/**
 * El folio público del caso (BUDI-000123), del embed `cases (folio)` de una
 * consulta a service_requests. Es el número que el Usuario le dicta a soporte:
 * el mismo de su pago y de su comprobante, no el id interno.
 * PostgREST lo devuelve como objeto (request_id es UNIQUE) o como arreglo,
 * según cómo infiera la relación; se aceptan las dos formas.
 */
export function caseFolio(cases: unknown): string | null {
  const row = Array.isArray(cases) ? cases[0] : cases;
  const folio = (row as { folio?: unknown } | null | undefined)?.folio;
  return typeof folio === 'string' ? folio : null;
}
