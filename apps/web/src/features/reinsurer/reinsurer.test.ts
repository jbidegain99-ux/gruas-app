import { describe, expect, it } from 'vitest';
import { cellValue, defaultRange, exportColumns, type Cell } from './reinsurer';
import { tableRows } from '@/shared/lib/export/table-export';

const pub: Cell = {
  suppressed: false, services: 12, cost: 960, avg_cost: 80, per_1000_members: 3.5,
  assignment_on_time_pct: 91.7, arrival_on_time_pct: 83.3,
};
const sup: Cell = { suppressed: true };

describe('reinsurer', () => {
  it('muestra "< 5" en servicios de una celda suprimida y nada en montos', () => {
    expect(cellValue(sup, 'services', 5)).toBe('< 5');
    expect(cellValue(sup, 'cost', 5)).toBeNull();
    expect(cellValue(pub, 'cost', 5)).toBe(960);
  });

  it('la exportación no inventa cifras para celdas suprimidas', () => {
    const rows = [{ insurer: 'A', ...pub }, { insurer: 'B', ...sup }];
    const m = tableRows(rows, exportColumns('Aseguradora', (r) => r.insurer, 5));
    expect(m[0][0]).toBe('Aseguradora');
    expect(m[1].slice(0, 3)).toEqual(['A', 12, 960]);
    expect(m[2].slice(0, 3)).toEqual(['B', '< 5', null]);
  });

  it('el rango por defecto cubre 12 meses completos hasta hoy', () => {
    expect(defaultRange(new Date(2026, 8, 29))).toEqual({ from: '2025-10-01', to: '2026-09-29' });
    expect(defaultRange(new Date(2026, 0, 5))).toEqual({ from: '2025-02-01', to: '2026-01-05' });
  });
});
