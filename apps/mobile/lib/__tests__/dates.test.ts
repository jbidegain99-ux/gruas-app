import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime, formatTime } from '../dates';

describe('dates (es-SV, America/El_Salvador)', () => {
  it('usa la hora de El Salvador (UTC-6), no la del dispositivo', () => {
    // 02:30 UTC del 1 de octubre = 20:30 del 30 de septiembre en El Salvador.
    const iso = '2026-10-01T02:30:00Z';
    expect(formatDateTime(iso, { day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })).toMatch(
      /30.*20:30/,
    );
    expect(formatTime(iso)).toMatch(/0?8:30|20:30/);
  });

  it('formatea la fecha en español', () => {
    expect(formatDate('2026-09-28T18:00:00Z', { day: 'numeric', month: 'long', year: 'numeric' })).toBe(
      '28 de septiembre de 2026',
    );
  });

  it('devuelve cadena vacía con una fecha inválida', () => {
    expect(formatDate('no-es-fecha')).toBe('');
  });
});
