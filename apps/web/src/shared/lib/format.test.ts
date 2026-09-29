import { describe, expect, it } from 'vitest';
import { formatDateTime } from './format';

describe('formatDateTime', () => {
  it('muestra la hora de El Salvador aunque el navegador esté en otra zona', () => {
    // 21:04 UTC = 15:04 en El Salvador (UTC-6, sin horario de verano).
    const s = formatDateTime('2026-09-28T21:04:00Z');
    expect(s).toContain('28');
    expect(s).toContain('15:04');
  });

  it('sin fecha, o con una inválida, muestra un guion', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('no-es-fecha')).toBe('—');
  });
});
