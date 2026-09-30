'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requiresDropoff } from '@gruas-app/shared';
import { createClient } from '@/shared/lib/supabase/client';
import { cargarCatalogoDestinos } from '@/shared/lib/dropoff-catalog';
import { ServiceTypeBadge } from '@/shared/components/ServiceTypeBadge';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { money } from '@/shared/lib/format';
// Mismo SLA y línea de tiempo que el admin y la aseguradora: las RPC dejan
// entrar al programa dueño del caso desde la 00100.
import { CaseSla } from '@/features/admin/CaseSla';
import { CaseTimeline } from '@/features/admin/CaseTimeline';
import type { LatLng } from './MoptMap';

const MoptMap = dynamic(() => import('./MoptMap'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-zinc-500">Cargando mapa…</div>,
});

type Detail = {
  id: string;
  folio: string | null;
  status: string;
  service_type: string;
  incident_type: string | null;
  client_name: string | null;
  vehicle_plate: string | null;
  vehicle: string | null;
  operator_name: string | null;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_address: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  created_at: string;
  completed_at: string | null;
  distance_km: number | null;
  total_price: number | null;
  trail: LatLng[];
};

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-SV', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/El_Salvador' }) : '—';

export default function MoptServiceDetailPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      // El catálogo primero: `requiresDropoff` lo lee de estado de módulo.
      await cargarCatalogoDestinos(supabase);
      const { data, error: e } = await supabase.rpc('mopt_service_detail', { p_request_id: id });
      if (!alive) return;
      if (e) setError(e.message);
      else setDetail(data as unknown as Detail);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-zinc-500">No se encontró el servicio.</p>
        <Link href="/mopt/servicios" className="mt-2 inline-block text-sm text-budi-primary-600 hover:underline">
          Volver a servicios
        </Link>
      </div>
    );
  }
  if (!detail) return <p className="py-16 text-center text-sm text-zinc-500">Cargando…</p>;

  const conDestino = requiresDropoff(detail.service_type);
  const pickup: LatLng | null = detail.pickup_lat != null && detail.pickup_lng != null ? [detail.pickup_lat, detail.pickup_lng] : null;
  const dropoff: LatLng | null =
    conDestino && detail.dropoff_lat != null && detail.dropoff_lng != null ? [detail.dropoff_lat, detail.dropoff_lng] : null;

  return (
    <div>
      <Link
        href="/mopt/servicios"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Servicios
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-bold text-zinc-900 dark:text-white">{detail.folio ?? 'Servicio'}</h1>
        <StatusBadge status={detail.status} />
        <ServiceTypeBadge serviceType={detail.service_type} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <section className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-5 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
            <Field label="Persona atendida">{detail.client_name ?? '—'}</Field>
            <Field label="Vehículo">
              {detail.vehicle_plate ? <span className="font-mono">{detail.vehicle_plate}</span> : '—'}
              {detail.vehicle && <span className="block text-xs text-zinc-500">{detail.vehicle}</span>}
            </Field>
            <Field label="Socio operador">{detail.operator_name ?? 'Sin asignar'}</Field>
            <Field label="Incidente">{detail.incident_type ?? '—'}</Field>
            <Field label="Recogida">{detail.pickup_address ?? '—'}</Field>
            {conDestino && <Field label="Destino">{detail.dropoff_address ?? '—'}</Field>}
            <Field label="Pedido">{fecha(detail.created_at)}</Field>
            <Field label="Completado">{fecha(detail.completed_at)}</Field>
            {detail.distance_km != null && conDestino && <Field label="Distancia del traslado">{Number(detail.distance_km).toFixed(1)} km</Field>}
            <Field label="Monto a pagar al socio operador">
              <span className="font-semibold">{detail.total_price == null ? '—' : money(Number(detail.total_price))}</span>
            </Field>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <CaseSla folio={detail.folio} />
          </section>
        </div>

        <div className="space-y-6">
          <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="h-80">
              <MoptMap pickup={pickup} dropoff={dropoff} trail={detail.trail} />
            </div>
            <p className="px-4 py-2 text-xs text-zinc-500">
              A = recogida{conDestino ? ' · B = destino' : ''}
              {detail.trail.length > 1 ? ' · en naranja, el recorrido real del socio operador' : ' · sin recorrido GPS registrado'}
            </p>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <CaseTimeline folio={detail.folio} />
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <div className="mt-0.5 text-sm text-zinc-900 dark:text-white">{children}</div>
    </div>
  );
}
