'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Inbox, Search } from 'lucide-react';
import type { ServiceRequestStatus, ServiceType } from '@gruas-app/shared';
import { requiresDropoff, SERVICE_TYPE_CONFIGS } from '@gruas-app/shared';
import { createClient } from '@/shared/lib/supabase/client';
import { cargarCatalogoDestinos } from '@/shared/lib/dropoff-catalog';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { ServiceTypeBadge } from '@/shared/components/ServiceTypeBadge';
import { CaseTimeline } from './CaseTimeline';
import { CaseSla } from './CaseSla';
import { NearestOperators } from './NearestOperators';
import { RequestChatLog, RequestNotes, RequestPinPanel, RequestTrail } from './RequestOpsPanels';
import { LocationMap } from '@/shared/components/LocationMap';
import { resolveDisplayAddress } from '@/shared/lib/geocoding';
import { useToast, useConfirm } from '@/shared/components/FeedbackProvider';
import { money } from '@/shared/lib/format';
import { Pagination } from '@/shared/components/Pagination';

const PAGE_SIZE = 20;

type ServiceRequest = {
  id: string;
  user_id: string;
  operator_id: string | null;
  tow_type: 'light' | 'heavy';
  service_type: string;
  status: string;
  pickup_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_address: string;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  incident_type: string;
  total_price: number | null;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  /**
   * B-11. covered | none | inactive | error; NULL = solicitud anterior a la
   * verificacion. Se tipa `string` como el resto de las columnas con CHECK de
   * esta tabla (`status`, `service_type`): la restriccion vive en la DB y el
   * tipo generado por Supabase es TEXT.
   */
  coverage_status: string | null;
  /** JSONB libre. Se lee con `coberturaDe()`, que valida la forma. */
  price_breakdown: unknown;
  profiles: { full_name: string; phone: string | null } | null;
  operator: { full_name: string; phone: string | null } | null;
  /** B-14. Embed 1:1 con `cases`; al ser to-one, PostgREST lo devuelve como objeto. */
  cases: { folio: string } | null;
};

// `servicios` son los slugs que declara la empresa del operador. Vacio = la
// empresa no declaro nada, y entonces no se filtra (misma regla que la 00073:
// falla abierta mientras no haya catalogo contra que contrastar).
type Operator = { id: string; full_name: string; servicios: Set<string> };

/** ¿La empresa de este operador presta el servicio de esta solicitud? */
function operadorPuedeAtender(op: Operator, serviceType: string | null): boolean {
  if (op.servicios.size === 0) return true;
  return op.servicios.has(serviceType || 'tow');
}

const ASSIGNABLE_STATUSES = ['initiated', 'assigned', 'en_route'];

// B-11. `error` es el unico que exige accion humana: la solicitud se atendio sin
// saber si habia cobertura, asi que alguien tiene que revisar la poliza y decidir
// quien paga. Por eso es el unico que se pinta en rojo y se muestra en la tabla;
// el resto solo aparece en el detalle para no ensuciar la lista.
const COVERAGE_LABEL: Record<string, { texto: string; clase: string }> = {
  covered:  { texto: 'Con cobertura',      clase: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  none:     { texto: 'Particular',         clase: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  inactive: { texto: 'Cobertura vencida',  clase: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  error:    { texto: 'Cobertura sin verificar', clase: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
};

/**
 * B-12 guarda el reparto de la cobertura bajo la clave `coverage` de
 * `price_breakdown` al cerrar el servicio.
 *
 * `price_breakdown` es JSONB: el tipo generado es `Json`, que tambien admite
 * string, numero y arreglo. Se valida la forma aca en vez de forzar un cast,
 * porque una fila vieja o escrita a mano puede traer cualquier cosa.
 */
type RepartoCobertura = {
  covered?: boolean;
  reason?: string;
  amount_covered?: number;
  amount_copay?: number;
  excess_km?: number;
  excess_km_charge?: number;
  included_km?: number;
  capped?: boolean;
  max_covered_amount?: number;
  events_used?: number;
  events_left?: number;
  services_per_year?: number;
};

function coberturaDe(r: ServiceRequest): RepartoCobertura | null {
  const pb = r.price_breakdown;
  if (!pb || typeof pb !== 'object' || Array.isArray(pb)) return null;
  const c = (pb as Record<string, unknown>).coverage;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  return c as RepartoCobertura;
}

// Una solicitud sin operador que lleva mucho tiempo esperando es urgente.
const URGENT_AFTER_MINUTES = 10;

function isUrgent(r: ServiceRequest): boolean {
  if (r.status !== 'initiated' || r.operator_id) return false;
  const ageMin = (Date.now() - new Date(r.created_at).getTime()) / 60000;
  return ageMin >= URGENT_AFTER_MINUTES;
}

export default function AdminRequestsPage() {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [assignOperatorId, setAssignOperatorId] = useState<string>('');
  const [assigning, setAssigning] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [pickupDisplay, setPickupDisplay] = useState('');
  const [dropoffDisplay, setDropoffDisplay] = useState('');
  const selectedIdRef = useRef<string | null>(null);
  const deepLinkedRef = useRef(false);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    const fetchRequests = async () => {
      const supabase = createClient();
      // El catalogo primero: `requiresDropoff` lo lee de estado de modulo, que no
      // dispara re-render por si solo. Cargandolo ANTES de traer las filas, para
      // cuando estas se pintan ya esta puesto y no hace falta un flag de estado.
      await cargarCatalogoDestinos(supabase);
      let query = supabase
        .from('service_requests')
        // Columnas explícitas, no `*`: el admin también es rol `authenticated`,
        // y `*` incluiría `pin_hash`, que dejó de ser legible (migr. 00056) → 403.
        // Están todas menos ese hash, que la vista de admin no necesita.
        .select(`
          id, user_id, operator_id, provider_id, tow_type, status,
          pickup_lat, pickup_lng, pickup_address,
          dropoff_lat, dropoff_lng, dropoff_address,
          incident_type, incident_description,
          vehicle_plate, vehicle_make, vehicle_model, vehicle_color,
          vehicle_doc_path, vehicle_photo_url,
          distance_operator_to_pickup_km, distance_pickup_to_dropoff_km,
          price_breakdown, total_price,
          created_at, updated_at, assigned_at, activated_at, completed_at, cancelled_at,
          notes, cancellation_reason, cancelled_by,
          service_type, service_details, route_polyline, pool_alerted_at, coverage_status,
          profiles!service_requests_user_id_fkey(full_name, phone),
          operator:profiles!service_requests_operator_id_fkey(full_name, phone),
          cases(folio)
        `)
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter as ServiceRequestStatus);
      }

      const { data } = await query.limit(300);
      setRequests(data || []);
      setLoading(false);
    };
    fetchRequests();
  }, [statusFilter, refreshKey]);

  // Refrescar en vivo cuando cambian las solicitudes (ej. un operador acepta)
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('admin-requests')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_requests' },
        () => setRefreshKey((k) => k + 1)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Cargar operadores disponibles para asignar, con lo que presta su empresa.
  // El servidor ya no se los sugiere al despachador si no corresponden (00074),
  // pero esta lista es la salida manual: se los deja elegir y se avisa.
  useEffect(() => {
    const fetchOperators = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, provider_id')
        .eq('role', 'OPERATOR')
        // 00117: la base rechaza asignar a un socio suspendido o sin aprobar.
        .eq('verification_status', 'approved')
        .order('full_name');
      if (!data) return;

      // Catalogo por empresa en una sola consulta, en vez de anidar la relacion
      // dos niveles por cada operador.
      const { data: catalogo } = await supabase
        .from('provider_services')
        .select('provider_id, is_available, services(slug)')
        .eq('is_available', true);

      const porEmpresa = new Map<string, Set<string>>();
      for (const fila of catalogo ?? []) {
        const slug = (fila.services as unknown as { slug: string } | null)?.slug;
        if (!slug || !fila.provider_id) continue;
        if (!porEmpresa.has(fila.provider_id)) porEmpresa.set(fila.provider_id, new Set());
        porEmpresa.get(fila.provider_id)!.add(slug);
      }

      setOperators(
        data.map((op) => ({
          id: op.id,
          full_name: op.full_name,
          servicios: (op.provider_id && porEmpresa.get(op.provider_id)) || new Set<string>(),
        }))
      );
    };
    fetchOperators();
  }, []);

  // Seleccionar una solicitud y preseleccionar su operador actual (si tiene).
  const selectRequest = (r: ServiceRequest | null) => {
    setSelectedRequest(r);
    setAssignOperatorId(r?.operator_id ?? '');
    setCancelReason('');
    selectedIdRef.current = r?.id ?? null;
    if (!r) {
      setPickupDisplay('');
      setDropoffDisplay('');
      return;
    }
    // Mostrar de una lo guardado; resolver coords -> dirección en segundo plano.
    setPickupDisplay(r.pickup_address);
    setDropoffDisplay(r.dropoff_address);
    resolveDisplayAddress(r.pickup_address, r.pickup_lat, r.pickup_lng).then((a) => {
      if (selectedIdRef.current === r.id) setPickupDisplay(a);
    });
    resolveDisplayAddress(r.dropoff_address, r.dropoff_lat, r.dropoff_lng).then((a) => {
      if (selectedIdRef.current === r.id) setDropoffDisplay(a);
    });
  };

  const refetch = () => setRefreshKey((k) => k + 1);

  // Deep-link (?request=<id>): abrir el drawer de esa solicitud una sola vez, p. ej.
  // al tocar "servicio en curso" en el Mapa de flota. Se difiere para no llamar
  // setState de forma síncrona dentro del efecto.
  useEffect(() => {
    if (deepLinkedRef.current || loading) return;
    const reqId = new URLSearchParams(window.location.search).get('request');
    if (!reqId) {
      deepLinkedRef.current = true;
      return;
    }
    const found = requests.find((r) => r.id === reqId);
    if (found) {
      deepLinkedRef.current = true;
      queueMicrotask(() => selectRequest(found));
    }
  }, [loading, requests]);

  const handleCancelRequest = async (requestId: string) => {
    const ok = await confirm({
      title: '¿Cancelar esta solicitud?',
      message: 'Esta acción no se puede deshacer.',
      confirmLabel: 'Cancelar solicitud',
      cancelLabel: 'Volver',
      destructive: true,
    });
    if (!ok) return;

    const supabase = createClient();
    // `p_reason` es opcional en la funcion, no nullable: se omite la clave
    // cuando no hay motivo en vez de mandar null.
    const motivo = cancelReason.trim();
    const { error } = await supabase.rpc('admin_cancel_request', {
      p_request_id: requestId,
      ...(motivo ? { p_reason: motivo } : {}),
    });
    if (error) {
      toast.error('No se pudo cancelar la solicitud.');
      return;
    }
    toast.success('Solicitud cancelada.');
    refetch();
    setSelectedRequest(null);
  };

  const handleAssignRequest = async (requestId: string) => {
    if (!assignOperatorId) return;

    // El servidor deja forzar la asignación a propósito (00074): el despachador
    // puede saber algo que el sistema no, y con un cliente varado al teléfono no
    // se le quita la última salida manual. Pero que sea a sabiendas.
    const op = operators.find((o) => o.id === assignOperatorId);
    const tipo = selectedRequest?.service_type || 'tow';
    if (op && !operadorPuedeAtender(op, tipo)) {
      const ok = await confirm({
        title: 'Esta empresa no presta este servicio',
        message:
          `La empresa de ${op.full_name} no tiene declarado "${SERVICE_TYPE_CONFIGS[tipo as ServiceType]?.name ?? tipo}" ` +
          'entre sus servicios, así que esta solicitud nunca le habría aparecido en su app. ¿Asignársela igual?',
        confirmLabel: 'Asignar de todos modos',
      });
      if (!ok) return;
    }

    setAssigning(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('admin_assign_request', {
      p_request_id: requestId,
      p_operator_id: assignOperatorId,
    });
    setAssigning(false);
    if (error) {
      toast.error(`No se pudo asignar el socio operador: ${error.message}`);
      return;
    }
    toast.success(selectedRequest?.operator_id ? 'Solicitud reasignada.' : 'Socio operador asignado.');
    refetch();
    setSelectedRequest(null);
  };

  const exportCSV = () => {
    const headers = ['ID', 'Usuario', 'Socio operador', 'Tipo', 'Estado', 'Origen', 'Destino', 'Precio', 'Fecha'];
    const rows = requests.map((r) => [
      r.id,
      r.profiles?.full_name || 'N/A',
      r.operator?.full_name || 'N/A',
      r.service_type || 'tow',
      r.status,
      r.pickup_address,
      // Sin destino real el dropoff es una copia del origen: dejamos la celda
      // vacia en vez de repetir la direccion.
      requiresDropoff(r.service_type) ? r.dropoff_address : '',
      r.total_price || 'N/A',
      new Date(r.created_at).toISOString(),
    ]);

    // Escapa cada celda: envuelve en comillas y duplica las comillas internas,
    // para que las direcciones con comas/comillas/saltos no rompan el CSV.
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map(cell).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solicitudes_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // Búsqueda client-side (cliente, teléfono, direcciones, ID) sobre lo cargado.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) =>
      [
        r.profiles?.full_name,
        r.profiles?.phone,
        r.pickup_address,
        r.dropoff_address,
        r.id,
      ]
        .filter(Boolean)
        .some((f) => (f as string).toLowerCase().includes(q))
    );
  }, [requests, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">
            Solicitudes
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Gestiona todas las solicitudes de servicio
          </p>
        </div>
        <button
          onClick={exportCSV}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Exportar CSV
        </button>
      </div>

      {/* Buscador */}
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Buscar por Usuario, teléfono o dirección..."
          className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        />
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        {['all', 'initiated', 'assigned', 'en_route', 'active', 'completed', 'cancelled'].map(
          (status) => (
            <button
              key={status}
              onClick={() => {
                setStatusFilter(status);
                setPage(0);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                statusFilter === status
                  ? 'bg-budi-primary-500 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              {status === 'all' && 'Todas'}
              {status === 'initiated' && 'Pendientes'}
              {status === 'assigned' && 'Asignadas'}
              {status === 'en_route' && 'En Camino'}
              {status === 'active' && 'Activas'}
              {status === 'completed' && 'Completadas'}
              {status === 'cancelled' && 'Canceladas'}
            </button>
          )
        )}
      </div>

      {/* Requests table (full width) */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800/60">
              <tr>
                {['Usuario', 'Tipo', 'Socio operador', 'Estado', 'Precio', 'Fecha'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-zinc-500">
                    Cargando…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <Inbox className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                    <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      {search.trim()
                        ? 'No se encontraron solicitudes con esa búsqueda'
                        : statusFilter === 'all'
                        ? 'No hay solicitudes'
                        : 'Sin solicitudes en este filtro'}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Las nuevas solicitudes aparecerán aquí automáticamente.
                    </p>
                  </td>
                </tr>
              ) : (
                paged.map((request) => {
                  const urgent = isUrgent(request);
                  return (
                    <tr
                      key={request.id}
                      onClick={() => selectRequest(request)}
                      className={`cursor-pointer transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
                        urgent ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''
                      } ${
                        selectedRequest?.id === request.id ? 'bg-budi-primary-50 dark:bg-budi-primary-900/20' : ''
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-zinc-900 dark:text-white">
                        {request.profiles?.full_name || 'N/A'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <ServiceTypeBadge serviceType={request.service_type || 'tow'} />
                        {(!request.service_type || request.service_type === 'tow') && (
                          <span className="ml-1 text-xs text-zinc-500">
                            {request.tow_type === 'light' ? 'Liviana' : 'Pesada'}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                        {request.operator?.full_name || (
                          <span className="text-zinc-400 dark:text-zinc-600">Sin asignar</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={request.status} />
                          {urgent && (
                            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">
                              Urgente
                            </span>
                          )}
                          {request.coverage_status === 'error' && (
                            <span
                              className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-300"
                              title="La verificación de cobertura falló; hay que revisar la póliza a mano"
                            >
                              Cobertura sin verificar
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                        {request.total_price ? money(request.total_price) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-500 dark:text-zinc-500">
                        {new Date(request.created_at).toLocaleDateString('es-SV')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={currentPage}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={setPage}
        />
      </div>

      {/* Detail drawer */}
      {selectedRequest && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => selectRequest(null)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Detalle de Solicitud</h2>
              <button
                onClick={() => selectRequest(null)}
                className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-6">
                <div>
                  <p className="text-xs text-zinc-500">Folio</p>
                  <p className="font-mono text-sm font-semibold text-zinc-900 dark:text-white">
                    {selectedRequest.cases?.folio ?? `${selectedRequest.id.substring(0, 8)}…`}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-zinc-500">Usuario</p>
                  <p className="text-sm text-zinc-900 dark:text-white">
                    {selectedRequest.profiles?.full_name || 'N/A'}
                  </p>
                  {selectedRequest.profiles?.phone && (
                    <a
                      href={`tel:${selectedRequest.profiles.phone}`}
                      className="text-sm font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
                    >
                      {selectedRequest.profiles.phone}
                    </a>
                  )}
                </div>

                <div>
                  <p className="text-xs text-zinc-500">Socio operador</p>
                  <p className="text-sm text-zinc-900 dark:text-white">
                    {selectedRequest.operator?.full_name || 'Sin asignar'}
                  </p>
                  {selectedRequest.operator?.phone && (
                    <a
                      href={`tel:${selectedRequest.operator.phone}`}
                      className="text-sm font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
                    >
                      {selectedRequest.operator.phone}
                    </a>
                  )}
                </div>

                <div>
                  <p className="text-xs text-zinc-500">Servicio</p>
                  <ServiceTypeBadge serviceType={selectedRequest.service_type || 'tow'} />
                </div>

                <div>
                  <p className="text-xs text-zinc-500">Incidente</p>
                  <p className="text-sm text-zinc-900 dark:text-white">
                    {selectedRequest.incident_type}
                  </p>
                </div>

                {selectedRequest.pickup_lat != null && selectedRequest.pickup_lng != null && (
                  <LocationMap
                    pickup={{ lat: selectedRequest.pickup_lat, lng: selectedRequest.pickup_lng }}
                    dropoff={
                      requiresDropoff(selectedRequest.service_type) &&
                      selectedRequest.dropoff_lat != null &&
                      selectedRequest.dropoff_lng != null
                        ? { lat: selectedRequest.dropoff_lat, lng: selectedRequest.dropoff_lng }
                        : null
                    }
                  />
                )}

                <div>
                  <p className="text-xs text-zinc-500">Origen</p>
                  <p className="text-sm text-zinc-900 dark:text-white">
                    {pickupDisplay || selectedRequest.pickup_address}
                  </p>
                </div>

                {requiresDropoff(selectedRequest.service_type) && (
                  <div>
                    <p className="text-xs text-zinc-500">Destino</p>
                    <p className="text-sm text-zinc-900 dark:text-white">
                      {dropoffDisplay || selectedRequest.dropoff_address}
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-xs text-zinc-500">Estado</p>
                  <StatusBadge status={selectedRequest.status} />
                </div>

                {/* B-11: cobertura. Se muestra tambien cuando es NULL para no dejar
                    la duda de si se verificó y salió vacío o nunca se verificó. */}
                <div>
                  <p className="text-xs text-zinc-500">Cobertura</p>
                  {selectedRequest.coverage_status ? (
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                        COVERAGE_LABEL[selectedRequest.coverage_status]?.clase ?? ''
                      }`}
                    >
                      {COVERAGE_LABEL[selectedRequest.coverage_status]?.texto ??
                        selectedRequest.coverage_status}
                    </span>
                  ) : (
                    <p className="text-sm text-zinc-500">
                      Anterior a la verificación de cobertura
                    </p>
                  )}
                  {selectedRequest.coverage_status === 'error' && (
                    <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                      El servicio se atendió sin poder confirmar la póliza. Revisa al afiliado
                      y decide quién paga; el motivo del fallo quedó en el historial del caso.
                    </p>
                  )}
                </div>

                {/* B-12: cómo se repartió el total. Solo existe una vez cerrado el
                    servicio, que es cuando hay precio final y km reales. */}
                {coberturaDe(selectedRequest) && (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      Reparto de la cobertura
                    </p>
                    {(() => {
                      const c = coberturaDe(selectedRequest)!;
                      if (!c.covered) {
                        return (
                          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                            No cubierto{c.reason ? `: ${c.reason}` : ''}. Paga el Usuario:{' '}
                            <strong>{money(c.amount_copay ?? 0)}</strong>
                          </p>
                        );
                      }
                      return (
                        <div className="mt-1 space-y-0.5 text-sm text-zinc-700 dark:text-zinc-300">
                          <p>
                            Aseguradora: <strong>{money(c.amount_covered ?? 0)}</strong> · Afiliado:{' '}
                            <strong>{money(c.amount_copay ?? 0)}</strong>
                          </p>
                          {!!c.excess_km && c.excess_km > 0 && (
                            <p className="text-xs text-zinc-500">
                              {c.excess_km} km por encima de los {c.included_km} incluidos ={' '}
                              {money(c.excess_km_charge ?? 0)} de copago
                            </p>
                          )}
                          {c.capped && (
                            <p className="text-xs text-zinc-500">
                              Alcanzó el tope de {money(c.max_covered_amount ?? 0)} por evento
                            </p>
                          )}
                          {c.services_per_year != null && (
                            <p className="text-xs text-zinc-500">
                              Evento {(c.events_used ?? 0) + 1} de {c.services_per_year} del año
                              {c.events_left != null && ` · quedan ${c.events_left}`}
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {selectedRequest.status === 'cancelled' && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
                    <p className="text-xs font-semibold uppercase tracking-wider text-red-700 dark:text-red-300">
                      Cancelación
                    </p>
                    <p className="mt-1 text-sm text-red-800 dark:text-red-200">
                      Cancelada por{' '}
                      {selectedRequest.cancelled_by === selectedRequest.user_id
                        ? 'el Usuario'
                        : selectedRequest.cancelled_by === selectedRequest.operator_id
                        ? 'el socio operador'
                        : selectedRequest.cancelled_by
                        ? 'el equipo Budi (admin)'
                        : 'origen desconocido'}
                      {selectedRequest.cancelled_at
                        ? ` · ${new Date(selectedRequest.cancelled_at).toLocaleString('es-SV')}`
                        : ''}
                    </p>
                    <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                      Motivo: {selectedRequest.cancellation_reason || 'No especificado'}
                    </p>
                  </div>
                )}

                {selectedRequest.total_price && (
                  <div>
                    <p className="text-xs text-zinc-500">Precio Total</p>
                    <p className="text-xl font-bold text-zinc-900 dark:text-white">
                      {money(selectedRequest.total_price)}
                    </p>
                  </div>
                )}

                {ASSIGNABLE_STATUSES.includes(selectedRequest.status) && (
                  <div className="mt-4 space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                    {/* B-16: sugerencia de despacho — los más cercanos, con distancia. */}
                    <NearestOperators
                      requestId={selectedRequest.id}
                      onAssigned={() => {
                        refetch();
                        setSelectedRequest(null);
                      }}
                    />

                    <div>
                      <p className="mb-2 text-xs font-medium uppercase text-zinc-500">
                        {selectedRequest.operator_id ? 'Reasignar manualmente' : 'Asignar manualmente'}
                      </p>
                      <select
                        value={assignOperatorId}
                        onChange={(e) => setAssignOperatorId(e.target.value)}
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                      >
                        <option value="">Selecciona un socio operador...</option>
                        {/* Se marcan, no se ocultan: la lista manual es la
                            salida de emergencia del despachador. */}
                        {operators.map((op) => {
                          const puede = operadorPuedeAtender(op, selectedRequest.service_type);
                          return (
                            <option key={op.id} value={op.id}>
                              {op.full_name}
                              {puede ? '' : ' — no presta este servicio'}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        onClick={() => handleAssignRequest(selectedRequest.id)}
                        disabled={!assignOperatorId || assigning || assignOperatorId === selectedRequest.operator_id}
                        className="mt-2 w-full rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {assigning ? 'Asignando...' : 'Asignar socio operador'}
                      </button>
                    </div>
                  </div>
                )}

                {!['completed', 'cancelled'].includes(selectedRequest.status) && (
                  <div className="mt-4">
                    {/* El motivo viaja al RPC y termina en la línea de tiempo del
                        caso (00072/00075). Sin esto las cancelaciones del panel
                        se veían mudas justo donde alguien las va a querer
                        explicar después. */}
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Motivo de la cancelación
                    </label>
                    <input
                      type="text"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Ej: duplicada, el Usuario ya no la necesita…"
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                    />
                    <button
                      onClick={() => handleCancelRequest(selectedRequest.id)}
                      className="mt-2 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                      Cancelar Solicitud
                    </button>
                  </div>
                )}

                {/* 00120 (runbook): herramientas de la guardia. */}
                <RequestPinPanel requestId={selectedRequest.id} status={selectedRequest.status} />
                <RequestNotes requestId={selectedRequest.id} />
                <RequestChatLog
                  requestId={selectedRequest.id}
                  userId={selectedRequest.user_id}
                  operatorId={selectedRequest.operator_id}
                />
                <RequestTrail
                  requestId={selectedRequest.id}
                  pickup={selectedRequest.pickup_lat != null && selectedRequest.pickup_lng != null ? { lat: selectedRequest.pickup_lat, lng: selectedRequest.pickup_lng } : null}
                  dropoff={selectedRequest.dropoff_lat != null && selectedRequest.dropoff_lng != null ? { lat: selectedRequest.dropoff_lat, lng: selectedRequest.dropoff_lng } : null}
                />

                {/* B-15: cumplimiento de SLA del caso. */}
                <CaseSla folio={selectedRequest.cases?.folio ?? null} />

                {/* B-14: la línea de tiempo del caso, con exportación. */}
                <CaseTimeline folio={selectedRequest.cases?.folio ?? null} />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
