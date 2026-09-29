'use client';

// Recorrido GPS de un servicio (service_location_trail) sobre OpenStreetMap.
// Se carga con ssr:false porque Leaflet toca `window` al montar.

import { useEffect } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type TrailPoint = { lat: number; lng: number; recorded_at: string };
type Pin = { lat: number; lng: number } | null;

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 16 });
  }, [map, points]);
  return null;
}

export default function TrailMap({ trail, pickup, dropoff }: { trail: TrailPoint[]; pickup: Pin; dropoff: Pin }) {
  const line = trail.map((p) => [p.lat, p.lng] as [number, number]);
  const all = [...line, ...(pickup ? [[pickup.lat, pickup.lng] as [number, number]] : []), ...(dropoff ? [[dropoff.lat, dropoff.lng] as [number, number]] : [])];
  const last = trail[trail.length - 1];

  return (
    <MapContainer center={all[0] ?? [13.6929, -89.2182]} zoom={13} style={{ height: 220, width: '100%', borderRadius: 8 }} scrollWheelZoom={false}>
      <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit points={all} />
      {line.length > 1 && <Polyline positions={line} pathOptions={{ color: '#2D5F8B', weight: 3 }} />}
      {pickup && (
        <CircleMarker center={[pickup.lat, pickup.lng]} radius={7} pathOptions={{ color: '#fff', fillColor: '#16a34a', fillOpacity: 1, weight: 2 }}>
          <Tooltip>Recogida</Tooltip>
        </CircleMarker>
      )}
      {dropoff && (
        <CircleMarker center={[dropoff.lat, dropoff.lng]} radius={7} pathOptions={{ color: '#fff', fillColor: '#dc2626', fillOpacity: 1, weight: 2 }}>
          <Tooltip>Destino</Tooltip>
        </CircleMarker>
      )}
      {last && (
        <CircleMarker center={[last.lat, last.lng]} radius={6} pathOptions={{ color: '#fff', fillColor: '#F5A25B', fillOpacity: 1, weight: 2 }}>
          <Tooltip>Último punto del socio · {new Date(last.recorded_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}</Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
