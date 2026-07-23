'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Inbox } from 'lucide-react';
import type { ServiceRequestStatus } from '@gruas-app/shared';
import { createClient } from '@/shared/lib/supabase/client';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { ServiceTypeBadge } from '@/shared/components/ServiceTypeBadge';
import { LocationMap } from '@/shared/components/LocationMap';
import { resolveDisplayAddress } from '@/shared/lib/geocoding';

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
  profiles: { full_name: string; phone: string | null } | null;
  operator: { full_name: string; phone: string | null } | null;
};

type Operator = { id: string; full_name: string };

const ASSIGNABLE_STATUSES = ['initiated', 'assigned', 'en_route'];

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
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [assignOperatorId, setAssignOperatorId] = useState<string>('');
  const [assigning, setAssigning] = useState(false);
  const [pickupDisplay, setPickupDisplay] = useState('');
  const [dropoffDisplay, setDropoffDisplay] = useState('');
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const fetchRequests = async () => {
      const supabase = createClient();
      let query = supabase
        .from('service_requests')
        .select(`
          *,
          profiles!service_requests_user_id_fkey(full_name, phone),
          operator:profiles!service_requests_operator_id_fkey(full_name, phone)
        `)
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter as ServiceRequestStatus);
      }

      const { data } = await query.limit(50);
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

  // Cargar operadores disponibles para asignar
  useEffect(() => {
    const fetchOperators = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'OPERATOR')
        .order('full_name');
      setOperators(data || []);
    };
    fetchOperators();
  }, []);

  // Seleccionar una solicitud y preseleccionar su operador actual (si tiene).
  const selectRequest = (r: ServiceRequest | null) => {
    setSelectedRequest(r);
    setAssignOperatorId(r?.operator_id ?? '');
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

  const handleCancelRequest = async (requestId: string) => {
    if (!confirm('Esta seguro de cancelar esta solicitud?')) return;

    const supabase = createClient();
    await supabase.rpc('admin_cancel_request', { p_request_id: requestId });
    refetch();
    setSelectedRequest(null);
  };

  const handleAssignRequest = async (requestId: string) => {
    if (!assignOperatorId) return;
    setAssigning(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('admin_assign_request', {
      p_request_id: requestId,
      p_operator_id: assignOperatorId,
    });
    setAssigning(false);
    if (error) {
      alert(`No se pudo asignar: ${error.message}`);
      return;
    }
    refetch();
    setSelectedRequest(null);
  };

  const handleAssignNearest = async (requestId: string) => {
    setAssigning(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('assign_nearest_operator', {
      p_request_id: requestId,
    });
    setAssigning(false);
    if (error) {
      alert(`No se pudo asignar automáticamente: ${error.message}`);
      return;
    }
    refetch();
    setSelectedRequest(null);
  };

  const exportCSV = () => {
    const headers = ['ID', 'Usuario', 'Operador', 'Tipo', 'Estado', 'Origen', 'Destino', 'Precio', 'Fecha'];
    const rows = requests.map((r) => [
      r.id,
      r.profiles?.full_name || 'N/A',
      r.operator?.full_name || 'N/A',
      r.service_type || 'tow',
      r.status,
      r.pickup_address,
      r.dropoff_address,
      r.total_price || 'N/A',
      new Date(r.created_at).toISOString(),
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solicitudes_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

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

      {/* Filters */}
      <div className="mb-6 flex gap-2">
        {['all', 'initiated', 'assigned', 'en_route', 'active', 'completed', 'cancelled'].map(
          (status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
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
                {['Usuario', 'Tipo', 'Operador', 'Estado', 'Precio', 'Fecha'].map((h) => (
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
                    Cargando...
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <Inbox className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                    <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      {statusFilter === 'all' ? 'No hay solicitudes' : 'Sin solicitudes en este filtro'}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Las nuevas solicitudes aparecerán aquí automáticamente.
                    </p>
                  </td>
                </tr>
              ) : (
                requests.map((request) => {
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
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                        {request.total_price ? `$${request.total_price}` : '—'}
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
                  <p className="text-xs text-zinc-500">ID</p>
                  <p className="text-sm text-zinc-900 dark:text-white">
                    {selectedRequest.id.substring(0, 8)}...
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
                  <p className="text-xs text-zinc-500">Operador</p>
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
                      selectedRequest.dropoff_lat != null && selectedRequest.dropoff_lng != null
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

                <div>
                  <p className="text-xs text-zinc-500">Destino</p>
                  <p className="text-sm text-zinc-900 dark:text-white">
                    {dropoffDisplay || selectedRequest.dropoff_address}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-zinc-500">Estado</p>
                  <StatusBadge status={selectedRequest.status} />
                </div>

                {selectedRequest.total_price && (
                  <div>
                    <p className="text-xs text-zinc-500">Precio Total</p>
                    <p className="text-xl font-bold text-zinc-900 dark:text-white">
                      ${selectedRequest.total_price}
                    </p>
                  </div>
                )}

                {ASSIGNABLE_STATUSES.includes(selectedRequest.status) && (
                  <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                    <p className="mb-2 text-xs font-medium uppercase text-zinc-500">
                      {selectedRequest.operator_id ? 'Reasignar operador' : 'Asignar operador'}
                    </p>
                    <select
                      value={assignOperatorId}
                      onChange={(e) => setAssignOperatorId(e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                    >
                      <option value="">Selecciona un operador...</option>
                      {operators.map((op) => (
                        <option key={op.id} value={op.id}>
                          {op.full_name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleAssignRequest(selectedRequest.id)}
                      disabled={!assignOperatorId || assigning || assignOperatorId === selectedRequest.operator_id}
                      className="mt-2 w-full rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {assigning ? 'Asignando...' : 'Asignar Operador'}
                    </button>
                    {selectedRequest.status === 'initiated' && (
                      <button
                        onClick={() => handleAssignNearest(selectedRequest.id)}
                        disabled={assigning}
                        className="mt-2 w-full rounded-lg border border-budi-primary-500 px-4 py-2 text-sm font-medium text-budi-primary-600 hover:bg-budi-primary-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-budi-primary-400 dark:hover:bg-budi-primary-900/20"
                      >
                        Asignar al más cercano (en línea)
                      </button>
                    )}
                  </div>
                )}

                {!['completed', 'cancelled'].includes(selectedRequest.status) && (
                  <button
                    onClick={() => handleCancelRequest(selectedRequest.id)}
                    className="mt-4 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                  >
                    Cancelar Solicitud
                  </button>
                )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
