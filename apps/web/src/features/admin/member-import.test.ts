import { describe, expect, it } from 'vitest';
import { chunk, mergeResults } from './member-import';

describe('member-import', () => {
  it('parte 10 000 filas en lotes de 1 000 con su desplazamiento', () => {
    const parts = chunk(Array.from({ length: 10_000 }, (_, i) => i));
    expect(parts).toHaveLength(10);
    expect(parts[3].offset).toBe(3000);
    expect(parts[3].rows[0]).toBe(3000);
    expect(chunk([1, 2, 3], 2).map((p) => p.rows)).toEqual([[1, 2], [3]]);
  });

  it('junta los resultados y numera los errores sobre el archivo completo', () => {
    const r = mergeResults(
      [
        { offset: 0, result: { inserted: 999, updated: 0, failed: 1, errors: [{ row: 5, document_number: '', message: 'Falta' }] } },
        { offset: 1000, result: { inserted: 998, updated: 1, failed: 1, errors: [{ row: 7, document_number: 'x', message: 'Mal' }] } },
      ],
      false
    );
    expect(r).toMatchObject({ inserted: 1997, updated: 1, failed: 2 });
    expect(r.errors.map((e) => e.row)).toEqual([5, 1007]);
  });

  it('si la base ya numeró sobre el archivo, no suma dos veces', () => {
    const r = mergeResults([{ offset: 1000, result: { inserted: 0, updated: 0, failed: 1, errors: [{ row: 1007, document_number: '', message: 'x' }] } }], true);
    expect(r.errors[0].row).toBe(1007);
  });
});
