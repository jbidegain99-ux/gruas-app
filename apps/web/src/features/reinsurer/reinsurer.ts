// Tablero de la reaseguradora (migr. 00131, REA-01/02). Solo agregados: toda
// celda con menos de `min_cell` casos llega suprimida desde la base.
import type { ExportColumn } from '@/shared/lib/export/table-export';

export type Cell =
  | { suppressed: true }
  | {
      suppressed: false;
      services: number;
      cost: number;
      avg_cost: number;
      per_1000_members: number | null;
      assignment_on_time_pct: number | null;
      arrival_on_time_pct: number | null;
    };

export type Dashboard = {
  period: { from: string; to: string };
  min_cell: number;
  cedents: { name: string; consent_status: 'pending' | 'granted' | 'revoked'; valid_from: string; valid_to: string | null }[];
  total: { services: number; cost: number; avg_cost: number | null; suppressed_insurers: number };
  by_insurer: ({ insurer: string } & Cell)[];
  by_service: ({ service_type: string } & Cell)[];
  by_month: ({ month: string } & Cell)[];
};

export const CONSENT_LABEL: Record<Dashboard['cedents'][number]['consent_status'], string> = {
  pending: 'Pendiente de autorizar',
  granted: 'Autorizado',
  revoked: 'Revocado',
};

/** Valor de una celda o "< N" si está suprimida. */
export function cellValue(
  c: Cell,
  key: 'services' | 'cost' | 'avg_cost' | 'per_1000_members' | 'assignment_on_time_pct' | 'arrival_on_time_pct',
  minCell: number,
): number | string | null {
  if (c.suppressed) return key === 'services' ? `< ${minCell}` : null;
  return c[key];
}

/** Columnas de exportación: las suprimidas salen como "< 5" y vacías. */
export function exportColumns<T extends Cell>(label: string, name: (r: T) => string, minCell: number): ExportColumn<T>[] {
  return [
    { header: label, value: name },
    { header: 'Servicios', value: (r) => cellValue(r, 'services', minCell) },
    { header: 'Costo cubierto (USD)', value: (r) => cellValue(r, 'cost', minCell) },
    { header: 'Costo promedio (USD)', value: (r) => cellValue(r, 'avg_cost', minCell) },
    { header: 'Por 1 000 afiliados', value: (r) => cellValue(r, 'per_1000_members', minCell) },
    { header: 'Asignación a tiempo (%)', value: (r) => cellValue(r, 'assignment_on_time_pct', minCell) },
    { header: 'Llegada a tiempo (%)', value: (r) => cellValue(r, 'arrival_on_time_pct', minCell) },
  ];
}

/** Rango por defecto: desde el primer día de hace 11 meses hasta hoy (12 meses). */
export function defaultRange(today: Date): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const from = new Date(Date.UTC(y, m - 11, 1));
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${from.getUTCFullYear()}-${pad(from.getUTCMonth() + 1)}-01`,
    to: `${y}-${pad(m + 1)}-${pad(today.getDate())}`,
  };
}
