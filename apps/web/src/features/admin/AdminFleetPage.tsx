'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Radio, RefreshCw, Truck, ArrowRight, AlertTriangle } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { fetchFleet, OPERATOR_STATE_META, type FleetOperator, type OperatorState } from './fleet-data';

// Leaflet toca `window` al montar: fuera del render del servidor.
const FleetMap = dynamic(() => import('./FleetMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      Cargando mapa…
    </div>
  ),
});

const ORDER: OperatorState[] = ['on_service', 'available', 'stale'];

export default function AdminFleetPage() {
  const supabase = useMemo(() => createClient(), []);
  const [operators, setOperators] = useState<FleetOperator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  // Contador de recargas: lo incrementan el botón, el realtime y el intervalo.
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let active = true;
    const loadFleet = async () => {
      try {
        const fleet = await fetchFleet(supabase, Date.now());
        if (!active) return;
        setOperators(fleet);
        setError(false);
        setUpdatedAt(new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }));
      } catch (e) {
        console.error('Error cargando flota:', e);
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadFleet();
    return () => {
      active = false;
    };
  }, [supabase, refreshKey]);

  useEffect(() => {
    // Realtime sobre las posiciones + refresco periódico, para que "sin señal"
    // aparezca aunque nadie escriba en la tabla.
    const channel = supabase
      .channel('admin-fleet')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operator_locations' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_requests' }, reload)
      .subscribe();

    const interval = setInterval(reload, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [supabase]);

  const byState = (s: OperatorState) => operators.filter((o) => o.state === s);
  const onService = byState('on_service').length;
  const available = byState('available').length;
  const stale = byState('stale').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Flota</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Operadores en el mapa, en vivo
          </p>
        </div>
        <button
          onClick={reload}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {updatedAt ? `Actualizado ${updatedAt}` : 'Actualizar'}
        </button>
      </div>

      {/* Resumen por estado */}
      <div className="grid gap-4 sm:grid-cols-3">
        {ORDER.map((state) => {
          const meta = OPERATOR_STATE_META[state];
          const value = state === 'on_service' ? onService : state === 'available' ? available : stale;
          return (
            <div
              key={state}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                {meta.label}
              </div>
              <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{value}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Mapa */}
        <div className="h-[560px] overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Cargando flota…
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <AlertTriangle className="h-10 w-10 text-red-400" />
              <p className="text-sm font-medium text-zinc-900 dark:text-white">No se pudo cargar la flota</p>
              <p className="max-w-xs text-sm text-zinc-500">Revisa tu conexión e intenta de nuevo.</p>
              <button
                onClick={reload}
                className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600"
              >
                Reintentar
              </button>
            </div>
          ) : operators.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <Truck className="h-10 w-10 text-zinc-300 dark:text-zinc-700" />
              <p className="text-sm font-medium text-zinc-900 dark:text-white">Sin operadores ubicados</p>
              <p className="max-w-xs text-sm text-zinc-500">
                Aparecerán aquí en cuanto un operador se ponga en línea desde la app.
              </p>
            </div>
          ) : (
            <FleetMap operators={operators} />
          )}
        </div>

        {/* Lista lateral */}
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <Radio className="h-4 w-4 text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
              Operadores ({operators.length})
            </h2>
          </div>
          <div className="max-h-[500px] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
            {operators.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-500">Nadie en el mapa todavía.</p>
            ) : (
              operators.map((op) => {
                const meta = OPERATOR_STATE_META[op.state];
                return (
                  <div key={op.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-zinc-900 dark:text-white">
                        {op.name}
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">Visto {op.lastSeenLabel}</p>
                    {op.activeRequestId && (
                      <Link
                        href={`/admin/requests?request=${op.activeRequestId}`}
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
                      >
                        {op.activeRequestAddress || 'Servicio en curso'}
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
