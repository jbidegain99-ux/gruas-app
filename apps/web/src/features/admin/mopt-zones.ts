// Polígonos de las zonas MOPT (migr. 00098): la base guarda [[lat, lng], ...] y el
// admin los edita como texto, un punto por línea.

export type LatLng = [number, number];

// Los mismos límites de El Salvador que usa create_service_request (00064): una
// zona fuera de ellos no podría contener ningún pedido.
const LAT_MIN = 13.0;
const LAT_MAX = 14.5;
const LNG_MIN = -90.2;
const LNG_MAX = -87.5;

export function polygonToText(polygon: LatLng[]): string {
  return polygon.map(([lat, lng]) => `${lat}, ${lng}`).join('\n');
}

export function parsePolygon(text: string): { ok: true; polygon: LatLng[] } | { ok: false; error: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const polygon: LatLng[] = [];
  for (const [i, line] of lines.entries()) {
    const parts = line.split(/[,;\s]+/).filter(Boolean);
    if (parts.length !== 2) {
      return { ok: false, error: `Línea ${i + 1}: se espera "latitud, longitud".` };
    }
    const [lat, lng] = parts.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, error: `Línea ${i + 1}: "${line}" no es un número válido.` };
    }
    if (lat < LAT_MIN || lat > LAT_MAX || lng < LNG_MIN || lng > LNG_MAX) {
      return { ok: false, error: `Línea ${i + 1}: el punto ${lat}, ${lng} está fuera de El Salvador. ¿Invertiste latitud y longitud?` };
    }
    polygon.push([lat, lng]);
  }

  // Si repitieron el primer punto al final para "cerrar" el polígono, se quita:
  // la base cierra sola.
  if (polygon.length > 1) {
    const [a, b] = [polygon[0], polygon[polygon.length - 1]];
    if (a[0] === b[0] && a[1] === b[1]) polygon.pop();
  }

  if (polygon.length < 3) {
    return { ok: false, error: 'Una zona necesita al menos 3 puntos distintos.' };
  }
  return { ok: true, polygon };
}
