// Filtros de la lista de casos de los portales (backlog POR-03). El rango de
// fechas va a la base (la RPC filtra por día en hora de El Salvador); estado,
// servicio, zona y folio se aplican sobre lo que la base ya entregó.

/**
 * Supabase corta cada respuesta en 1 000 filas (max_rows): si una lista llega
 * con justo esas, faltan casos y hay que avisarlo en vez de mostrar totales cortos.
 */
export const PORTAL_MAX_ROWS = 1000;

export type CaseLike = {
  folio: string | null;
  status: string;
  service_type: string;
  zone: string | null;
};

export type CaseFilterState = {
  from: string;
  to: string;
  status: string; // '' = todos
  service: string;
  zone: string;
  q: string; // folio (o parte)
};

export function defaultCaseFilters(today: string): CaseFilterState {
  return { from: today.slice(0, 8) + '01', to: today, status: '', service: '', zone: '', q: '' };
}

/** Normaliza lo que se escribe en la búsqueda: "budi 12" → "BUDI12". */
function normFolio(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function filterCases<T extends CaseLike>(rows: T[], f: CaseFilterState): T[] {
  const q = normFolio(f.q);
  return rows.filter(
    (r) =>
      (!f.status || r.status === f.status) &&
      (!f.service || r.service_type === f.service) &&
      (!f.zone || r.zone === f.zone) &&
      // "12" encuentra BUDI-000012; "BUDI-000012" también.
      (!q || normFolio(r.folio ?? '').includes(q) || normFolio(r.folio ?? '').replace(/^BUDI0*/, '') === q.replace(/^BUDI0*/, ''))
  );
}

/** Opciones de zona a partir de los datos, ordenadas. */
export function zoneOptions(rows: CaseLike[]): string[] {
  return [...new Set(rows.map((r) => r.zone).filter((z): z is string => !!z))].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Filtros → parte del nombre del archivo exportado. */
export function exportBasename(prefix: string, f: CaseFilterState): string {
  return `${prefix}_${f.from}_a_${f.to}`;
}
