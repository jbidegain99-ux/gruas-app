import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// El geocoder nativo busca en todo el mundo: en el recorrido del 2026-09-30
// "Zaragoza" devolvió la de España y el resumen dejó de ser "Sin costo" MOPT.
const geocodeAsync = vi.fn();
vi.mock('expo-location', () => ({
  geocodeAsync: (q: string) => geocodeAsync(q),
  reverseGeocodeAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(),
  Accuracy: { Balanced: 3 },
}));

import { inElSalvador, searchPlaces, withTimeout } from '../geocoding';

const ZARAGOZA_ESPANA = { latitude: 41.6488, longitude: -0.8891 };
const ZARAGOZA_SV = { latitude: 13.585, longitude: -89.289 };

describe('inElSalvador', () => {
  it('acepta puntos del país y rechaza los de fuera', () => {
    expect(inElSalvador(ZARAGOZA_SV.latitude, ZARAGOZA_SV.longitude)).toBe(true);
    expect(inElSalvador(ZARAGOZA_ESPANA.latitude, ZARAGOZA_ESPANA.longitude)).toBe(false);
  });
});

describe('searchPlaces', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    geocodeAsync.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('le pide El Salvador al geocoder y descarta lo que cae fuera', async () => {
    geocodeAsync.mockResolvedValue([ZARAGOZA_ESPANA, ZARAGOZA_SV]);
    const r = await searchPlaces('Zaragoza');
    expect(geocodeAsync).toHaveBeenCalledWith('Zaragoza, El Salvador');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ lat: ZARAGOZA_SV.latitude, lng: ZARAGOZA_SV.longitude });
  });

  it('si el geocoder solo trae resultados de fuera, busca en OSM (solo El Salvador)', async () => {
    geocodeAsync.mockResolvedValue([ZARAGOZA_ESPANA]);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { display_name: 'Zaragoza, La Libertad, El Salvador', lat: '13.585', lon: '-89.289' },
        { display_name: 'Zaragoza, Aragón, España', lat: '41.64', lon: '-0.88' },
      ],
    });
    const r = await searchPlaces('Zaragoza');
    expect(String(fetchMock.mock.calls[0][0])).toContain('countrycodes=sv');
    expect(r).toEqual([{ label: 'Zaragoza', secondary: 'La Libertad, El Salvador', lat: 13.585, lng: -89.289 }]);
  });

  it('si el geocoder no responde, no se queda esperando', async () => {
    vi.useFakeTimers();
    geocodeAsync.mockReturnValue(new Promise(() => {}));
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    const p = searchPlaces('Zaragoza');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toEqual([]);
    vi.useRealTimers();
  });
});

describe('withTimeout', () => {
  it('rechaza cuando la promesa no llega a tiempo', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 1000);
    vi.advanceTimersByTime(1000);
    await expect(p).rejects.toThrow('timeout');
    vi.useRealTimers();
  });
});
