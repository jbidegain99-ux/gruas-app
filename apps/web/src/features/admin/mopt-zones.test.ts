import { describe, expect, it } from 'vitest';
import { parsePolygon, polygonToText } from './mopt-zones';

describe('parsePolygon', () => {
  it('lee un punto por línea, con coma o espacio', () => {
    const r = parsePolygon('13.52, -89.38\n13.52 -89.28\n\n13.60,-89.28\n');
    expect(r).toEqual({ ok: true, polygon: [[13.52, -89.38], [13.52, -89.28], [13.6, -89.28]] });
  });

  it('quita el punto de cierre repetido', () => {
    const r = parsePolygon('13.5, -89.4\n13.5, -89.3\n13.6, -89.3\n13.5, -89.4');
    expect(r.ok && r.polygon).toHaveLength(3);
  });

  it('rechaza menos de 3 puntos distintos', () => {
    expect(parsePolygon('13.5, -89.4\n13.6, -89.3').ok).toBe(false);
    // 3 líneas pero la última cierra sobre la primera: quedan 2.
    expect(parsePolygon('13.5, -89.4\n13.6, -89.3\n13.5, -89.4').ok).toBe(false);
  });

  it('detecta latitud y longitud invertidas', () => {
    const r = parsePolygon('-89.38, 13.52\n-89.28, 13.52\n-89.28, 13.60');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invertiste/);
  });

  it('señala la línea con basura', () => {
    const r = parsePolygon('13.5, -89.4\nhola, mundo\n13.6, -89.3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Línea 2/);
  });

  it('ida y vuelta con polygonToText', () => {
    const polygon: [number, number][] = [[13.52, -89.38], [13.52, -89.28], [13.6, -89.28]];
    const r = parsePolygon(polygonToText(polygon));
    expect(r).toEqual({ ok: true, polygon });
  });
});
