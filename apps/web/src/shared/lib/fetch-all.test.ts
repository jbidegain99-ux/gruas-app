import { describe, expect, it } from 'vitest';
import { fetchAll, PAGE_ROWS } from './fetch-all';

// Un servidor falso con `total` filas que corta en PAGE_ROWS, como PostgREST.
const server = (total: number, failAt?: number) => {
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    if (failAt !== undefined && from >= failAt) return { data: null, error: { message: 'boom' } };
    const end = Math.min(to + 1, total, from + PAGE_ROWS);
    return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null };
  };
  return { page, calls };
};

describe('fetchAll', () => {
  it('trae más de max_rows filas, sin repetir ni saltar', async () => {
    const s = server(2500);
    const { data, error } = await fetchAll(s.page);
    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(data[0]).toBe(0);
    expect(data[2499]).toBe(2499);
    expect(s.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('con un múltiplo exacto pide una tanda vacía más y termina', async () => {
    const s = server(2000);
    expect((await fetchAll(s.page)).data).toHaveLength(2000);
    expect(s.calls).toHaveLength(3);
  });

  it('con pocas filas hace una sola consulta', async () => {
    const s = server(5);
    expect((await fetchAll(s.page)).data).toHaveLength(5);
    expect(s.calls).toHaveLength(1);
  });

  it('un error corta y se informa', async () => {
    const s = server(2500, 1000);
    const { data, error } = await fetchAll(s.page);
    expect(error?.message).toBe('boom');
    expect(data).toHaveLength(1000);
  });
});
