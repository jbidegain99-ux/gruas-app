// Mapa embebido gratuito (OpenStreetMap, sin API key) para el panel del admin.
// Muestra un recuadro con la zona de recogida/destino y un marcador en la
// recogida. Usa el iframe oficial de OSM — cero dependencias.

interface Coords {
  lat: number;
  lng: number;
}

interface LocationMapProps {
  pickup: Coords;
  dropoff?: Coords | null;
  height?: number;
}

export function LocationMap({ pickup, dropoff, height = 200 }: LocationMapProps) {
  const points = [pickup, ...(dropoff && dropoff.lat && dropoff.lng ? [dropoff] : [])];
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);

  // bbox con un pequeño margen para que los puntos no queden en el borde
  const pad = 0.008;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;
  const minLng = Math.min(...lngs) - pad;
  const maxLng = Math.max(...lngs) + pad;

  const bbox = `${minLng}%2C${minLat}%2C${maxLng}%2C${maxLat}`;
  const marker = `${pickup.lat}%2C${pickup.lng}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;

  const linkPts = points.map((p) => `${p.lat},${p.lng}`).join(';');
  const fullLink = `https://www.openstreetmap.org/directions?route=${linkPts}`;

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
      <iframe
        title="Ubicación"
        src={src}
        style={{ height, width: '100%', border: 0 }}
        loading="lazy"
      />
      <a
        href={fullLink}
        target="_blank"
        rel="noopener noreferrer"
        className="block bg-zinc-50 px-3 py-1.5 text-center text-xs font-medium text-budi-primary-600 hover:underline dark:bg-zinc-800 dark:text-budi-primary-400"
      >
        Ver mapa completo
      </a>
    </div>
  );
}
