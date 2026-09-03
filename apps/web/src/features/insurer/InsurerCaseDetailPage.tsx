'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
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

export default function InsurerCaseDetailPage({ folio }: { folio: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    createClient()
      .from('cases')
      .select(
        'folio, service_requests(status, service_type, created_at, pickup_address, dropoff_address, total_price, coverage_status)',
      )
      .eq('folio', folio)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const sr = (data as { service_requests: Detail } | null)?.service_requests ?? null;
        if (!sr) setNotFound(true);
        else setDetail(sr);
        setLoading(false);
      });
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
          {detail.dropoff_address && (
            <Field label="Destino">
              <span className="text-sm text-zinc-900 dark:text-white">{detail.dropoff_address}</span>
            </Field>
          )}
          {detail.total_price != null && (
            <Field label="Precio del servicio">
              <span className="text-lg font-bold text-zinc-900 dark:text-white">{money(detail.total_price)}</span>
            </Field>
          )}
          <CaseSla folio={folio} />
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <CaseTimeline folio={folio} />
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
