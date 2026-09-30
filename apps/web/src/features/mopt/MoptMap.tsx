'use client';

// Mapa del portal MOPT (migr. 00100). Leaflet + tiles de OpenStreetMap, igual que
// el mapa de flota del admin: sin API key. Se carga con ssr:false porque Leaflet
// toca `window` al montar. Un solo componente para la flota en vivo y para el
// detalle de un servicio: cada capa es opcional.

import { useEffect } from 'react';
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type LatLng = [number, number];

export type MapOperator = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Color del pin según su estado (en servicio / disponible / sin señal). */
  color: string;
  lines: string[];
};

export type MapPoint = { id: string; lat: number; lng: number; label: string; color: string };
export type MapZone = { id: string; name: string; polygon: LatLng[]; active: boolean };

const DEFAULT_CENTER: LatLng = [13.6929, -89.2182];

function pin(color: string, text: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:9999px;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font:600 12px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${text}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
}

/**
 * Encuadra todo lo que se dibujó, y solo cuando cambia el conjunto de cosas
 * dibujadas (`fitKey`: sus ids), no cuando se mueven. La página del mapa recarga
 * cada 30 s y cada operador que se movía reencuadraba y le borraba el zoom a
 * quien estaba mirando.
 */
function FitBounds({ points, fitKey }: { points: LatLng[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

export default function MoptMap({
  operators = [],
  points = [],
  zones = [],
  trail = [],
  pickup,
  dropoff,
}: {
  operators?: MapOperator[];
  points?: MapPoint[];
  zones?: MapZone[];
  trail?: LatLng[];
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
}) {
  const all: LatLng[] = [
    ...operators.map((o) => [o.lat, o.lng] as LatLng),
    ...points.map((p) => [p.lat, p.lng] as LatLng),
    ...trail,
    ...(pickup ? [pickup] : []),
    ...(dropoff ? [dropoff] : []),
  ];
  // Las zonas activas entran al encuadre: son el área que el programa atiende,
  // y sin ellas el mapa se acercaba a los puntos y dejaba la zona fuera de vista.
  const bounds = [...all, ...zones.filter((z) => z.active).flatMap((z) => z.polygon)];
  // Identidad del conjunto, sin coordenadas. Recorrido, recogida y destino
  // cuentan solo por si están o no (el recorrido crece mientras avanza).
  const fitKey = [
    zones.filter((z) => z.active).map((z) => z.id).sort().join(','),
    operators.map((o) => o.id).sort().join(','),
    points.map((p) => p.id).sort().join(','),
    trail.length > 0 ? 't' : '',
    pickup ? 'p' : '',
    dropoff ? 'd' : '',
  ].join('|');

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={11} scrollWheelZoom style={{ height: '100%', width: '100%' }} className="z-0">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={bounds} fitKey={fitKey} />

      {zones.map((z) => (
        <Polygon
          key={z.id}
          positions={z.polygon}
          pathOptions={{ color: '#2D5F8B', weight: 2, fillOpacity: z.active ? 0.08 : 0.02, dashArray: z.active ? undefined : '6 6' }}
        >
          <Tooltip sticky>{z.name}{z.active ? '' : ' (inactiva)'}</Tooltip>
        </Polygon>
      ))}

      {trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: '#F5A25B', weight: 4 }} />}

      {points.map((p) => (
        <CircleMarker key={p.id} center={[p.lat, p.lng]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: p.color, fillOpacity: 0.9 }}>
          <Tooltip>{p.label}</Tooltip>
        </CircleMarker>
      ))}

      {pickup && (
        <Marker position={pickup} icon={pin('#2D5F8B', 'A')}>
          <Popup>Recogida</Popup>
        </Marker>
      )}
      {dropoff && (
        <Marker position={dropoff} icon={pin('#dc2626', 'B')}>
          <Popup>Destino</Popup>
        </Marker>
      )}

      {operators.map((op) => (
        <Marker key={op.id} position={[op.lat, op.lng]} icon={pin(op.color, (op.name || '?').trim().charAt(0).toUpperCase())}>
          <Popup>
            <div className="min-w-[180px] space-y-1 text-sm">
              <p className="font-semibold text-zinc-900">{op.name}</p>
              {op.lines.map((l) => (
                <p key={l} className="text-zinc-600">{l}</p>
              ))}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
