import { describe, expect, it } from 'vitest';
import { lastSeen, ratingLabel, staleOnService } from './mopt-fleet';

const NOW = Date.parse('2026-10-01T16:00:00Z');
const hace = (min: number) => new Date(NOW - min * 60000).toISOString();

describe('mopt-fleet', () => {
  it('calificación: promedio con una decimal y cantidad', () => {
    expect(ratingLabel(4.75, 12)).toMatch(/^★ 4[.,]8 \(12\)$/);
    expect(ratingLabel('5.0', '1')).toMatch(/^★ 5[.,]0 \(1\)$/);
    expect(ratingLabel(null, 0)).toBe('Sin calificaciones');
    expect(ratingLabel(4, 0)).toBe('Sin calificaciones');
  });

  it('sin señal con servicio en curso: más de 5 min sin GPS, o nunca', () => {
    expect(staleOnService({ active_request_id: 'r', updated_at: hace(6) }, NOW)).toBe(true);
    expect(staleOnService({ active_request_id: 'r', updated_at: null }, NOW)).toBe(true);
    expect(staleOnService({ active_request_id: 'r', updated_at: hace(2) }, NOW)).toBe(false);
    // Sin servicio abierto no es alerta, aunque no tenga señal.
    expect(staleOnService({ active_request_id: null, updated_at: hace(600) }, NOW)).toBe(false);
  });

  it('visto hace…', () => {
    expect(lastSeen(null, NOW)).toBe('nunca');
    expect(lastSeen(hace(7), NOW)).toBe('hace 7 min');
    expect(lastSeen(hace(120), NOW)).toBe('hace 2 h');
    expect(lastSeen(hace(60 * 72), NOW)).toBe('hace 3 d');
  });
});
