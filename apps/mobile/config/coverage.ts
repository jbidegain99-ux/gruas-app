// Zona de cobertura del servicio. Por ahora es un recuadro que cubre El
// Salvador; a futuro se puede segmentar por proveedor o usar polígonos reales.
export const COVERAGE = {
  areaName: 'El Salvador',
  minLat: 13.0,
  maxLat: 14.5,
  minLng: -90.2,
  maxLng: -87.5,
} as const;

export function isWithinCoverage(lat: number, lng: number): boolean {
  return (
    lat >= COVERAGE.minLat &&
    lat <= COVERAGE.maxLat &&
    lng >= COVERAGE.minLng &&
    lng <= COVERAGE.maxLng
  );
}
