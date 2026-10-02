'use client';

// Mapa de flota: todos los operadores con ubicación conocida, en un solo mapa.
// Leaflet + tiles de OpenStreetMap (sin API key). Se carga con ssr:false desde
// AdminFleetPage porque Leaflet toca `window` al montar.

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { FleetOperator } from './fleet-data';
import { OPERATOR_STATE_META } from './fleet-data';
import { formatPhone } from '@gruas-app/shared';

// Centro por defecto: San Salvador, cuando ningún operador tiene ubicación.
const DEFAULT_CENTER: [number, number] = [13.6929, -89.2182];

/** Marcador circular con la inicial del operador; evita los assets rotos de Leaflet. */
function operatorIcon(op: FleetOperator): L.DivIcon {
  const meta = OPERATOR_STATE_META[op.state];
  const initial = (op.name || '?').trim().charAt(0).toUpperCase();
  return L.divIcon({
    className: '',
    html: `<div style="
      width:32px;height:32px;border-radius:9999px;
      background:${meta.pin};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font:600 13px/1 system-ui,sans-serif;
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);
    ">${initial}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  });
}

/** Encuadra el mapa sobre los operadores cada vez que cambia el conjunto. */
function FitBounds({ operators }: { operators: FleetOperator[] }) {
  const map = useMap();
  const key = operators.map((o) => `${o.id}:${o.lat.toFixed(4)},${o.lng.toFixed(4)}`).join('|');

  useEffect(() => {
    if (operators.length === 0) return;
    if (operators.length === 1) {
      map.setView([operators[0].lat, operators[0].lng], 14);
      return;
    }
    map.fitBounds(
      L.latLngBounds(operators.map((o) => [o.lat, o.lng] as [number, number])),
      { padding: [48, 48], maxZoom: 15 }
    );
    // `key` resume las posiciones: sólo reencuadra cuando alguna cambió de verdad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);

  return null;
}

export default function FleetMap({ operators }: { operators: FleetOperator[] }) {
  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={11}
      scrollWheelZoom
      style={{ height: '100%', width: '100%' }}
      className="z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds operators={operators} />
      {operators.map((op) => (
        <Marker key={op.id} position={[op.lat, op.lng]} icon={operatorIcon(op)}>
          <Popup>
            <div className="min-w-[180px] space-y-1 text-sm">
              <p className="font-semibold text-zinc-900">{op.name}</p>
              <p className="text-zinc-600">{OPERATOR_STATE_META[op.state].label}</p>
              {op.activeRequestAddress && (
                <p className="text-zinc-600">Servicio: {op.activeRequestAddress}</p>
              )}
              {op.phone && <p className="text-zinc-600">{formatPhone(op.phone)}</p>}
              <p className="text-xs text-zinc-500">Visto {op.lastSeenLabel}</p>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
