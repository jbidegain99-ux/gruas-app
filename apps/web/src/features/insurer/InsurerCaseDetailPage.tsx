'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requiresDropoff } from '@gruas-app/shared';
import { createClient } from '@/shared/lib/supabase/client';
import { cargarCatalogoDestinos } from '@/shared/lib/dropoff-catalog';
import { ServiceTypeBadge } from '@/shared/components/ServiceTypeBadge';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { money } from '@/shared/lib/format';
import { CaseSla } from '@/features/admin/CaseSla';
import { CaseTimeline } from '@/features/admin/CaseTimeline';

// B-17: detalle de un caso para la aseguradora. Reusa el SLA y la línea de tiempo
// del panel de admin — las RPC ya dejan entrar a la aseguradora dueña (00068).
type Detail = {
  status: string;
  service_type: string;
  created_at: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  total_price: number | null;
  coverage_status: string | null;
};

/** El reparto del caso. Vive en `coverage_usage`; la aseguradora ve el suyo desde la migr. 00084. */
type Reparto = { amount_covered: number; amount_copay: number };

export default function InsurerCaseDetailPage({ folio }: { folio: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reparto, setReparto] = useState<Reparto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      // El catalogo primero: `requiresDropoff` lo lee de estado de modulo, que no
      // dispara re-render por si solo. Cargandolo ANTES de guardar el detalle,
      // para cuando este se pinta ya esta puesto.
      await cargarCatalogoDestinos(supabase);
      const { data } = await supabase
        .from('cases')
        .select(
          'folio, request_id, service_requests(status, service_type, created_at, pickup_address, dropoff_address, total_price, coverage_status)',
        )
        .eq('folio', folio)
        .maybeSingle();
      if (!alive) return;

      // El reparto va aparte: `coverage_usage` no cuelga de `cases`.
      const requestId = (data as { request_id?: string } | null)?.request_id;
      if (requestId) {
        const { data: cu } = await supabase
          .from('coverage_usage')
          .select('amount_covered, amount_copay')
          .eq('request_id', requestId)
          .maybeSingle();
        if (alive && cu) setReparto(cu as Reparto);
      }
      const sr = (data as { service_requests: Detail } | null)?.service_requests ?? null;
      if (!sr) setNotFound(true);
      else setDetail(sr);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [folio]);

  if (loading) return <p className="py-16 text-center text-sm text-zinc-500">Cargando…</p>;

  if (notFound || !detail) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-zinc-500">No se encontró el caso {folio}.</p>
        <Link href="/portal" className="mt-2 inline-block text-sm text-budi-primary-600 hover:underline">
          Volver a tus casos
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/portal"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Tus casos
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-bold text-zinc-900 dark:text-white">{folio}</h1>
        <StatusBadge status={detail.status} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <Field label="Servicio">
            <ServiceTypeBadge serviceType={detail.service_type || 'tow'} />
          </Field>
          <Field label="Fecha">
            <span className="text-sm text-zinc-900 dark:text-white">
              {new Date(detail.created_at).toLocaleString('es-SV', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </Field>
          <Field label="Origen">
            <span className="text-sm text-zinc-900 dark:text-white">{detail.pickup_address || '—'}</span>
          </Field>
          {/* `dropoff_address` SIEMPRE viene lleno: las columnas son NOT NULL y la
              movil copia el origen cuando el servicio no traslada el vehiculo. Sin
              preguntarle al catalogo, una cerrajeria mostraba "Destino" repitiendo
              la direccion de recogida. */}
          {requiresDropoff(detail.service_type) && detail.dropoff_address && (
            <Field label="Destino">
              <span className="text-sm text-zinc-900 dark:text-white">{detail.dropoff_address}</span>
            </Field>
          )}
          {detail.total_price != null && (
            <Field label="Precio del servicio">
              <span className="text-sm text-zinc-900 dark:text-white">{money(detail.total_price)}</span>
            </Field>
          )}
          {/* Lo que de verdad se le factura. El precio de arriba incluye el
              copago del afiliado, que no le corresponde a la aseguradora:
              destacar el bruto le prometía una cifra que no era la suya. */}
          {reparto && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
              <p className="text-xs text-emerald-800 dark:text-emerald-300">A cargo de tu póliza</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-emerald-900 dark:text-emerald-200">
                {money(Number(reparto.amount_covered))}
              </p>
              <p className="mt-1 text-xs text-emerald-800/80 dark:text-emerald-300/80">
                El afiliado paga {money(Number(reparto.amount_copay))} de copago.
              </p>
            </div>
          )}
          <CaseSla folio={folio} />
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <CaseTimeline folio={folio} bare />
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-xs text-zinc-500">{label}</p>
      {children}
    </div>
  );
}
