// Teléfonos de El Salvador: una sola regla para web, app y base (00161).
// Se guardan como "+503XXXXXXXX" (8 dígitos que empiezan en 2, 6 o 7) y se
// muestran como "+503 7123-4567". Un número de otro país se deja tal cual.

const digits = (s: string) => s.replace(/\D/g, '');

/** Los 8 dígitos locales, o null si no es un número de El Salvador. */
export function svPhoneDigits(raw: string | null | undefined): string | null {
  const d = digits(raw ?? '').replace(/^503(?=\d{8}$)/, '');
  return /^[267]\d{7}$/.test(d) ? d : null;
}

/** Para mostrar: "+50371234567" o "7123-4567" -> "+503 7123-4567". */
export function formatPhone(raw: string | null | undefined): string {
  const d = svPhoneDigits(raw);
  if (d) return `+503 ${d.slice(0, 4)}-${d.slice(4)}`;
  return (raw ?? '').trim();
}

/**
 * ¿La búsqueda apunta a este teléfono? Compara solo dígitos, así "7123-4567",
 * "71234567" y "+503 7123 4567" encuentran el mismo número. Pide al menos 4
 * dígitos para no traer medio padrón con un "7".
 */
export function phoneMatches(phone: string | null | undefined, query: string): boolean {
  const q = digits(query);
  return q.length >= 4 && digits(phone ?? '').includes(q);
}
