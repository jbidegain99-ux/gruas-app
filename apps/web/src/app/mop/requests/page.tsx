'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

type ServiceRequest = {
  id: string;
  status: string;
  tow_type: string;
  incident_type: string;
  pickup_address: string;
  dropoff_address: string;
  total_price: number | null;
  distance_km: number | null;
  created_at: string;
  completed_at: string | null;
  user_name: string | null;
  user_email: string | null;
  provider_name: string | null;
  operator_name: string | null;
};

type AuditEvent = {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  created_at: string;
};

const STATUS_COLORS: Record<string, string> = {
  initiated: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  assigned: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  en_route: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  completed: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

const STATUS_LABELS: Record<string, string> = {
  initiated: 'Pendiente',
  assigned: 'Asignada',
  en_route: 'En Camino',
  active: 'Activa',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

const EVENT_LABELS: Record<string, string> = {
  created: 'Solicitud Creada',
  assigned: 'Operador Asignado',
  en_route: 'Grua en Camino',
  arrived: 'Grua Llegó',
  service_started: 'Servicio Iniciado',
  service_completed: 'Servicio Completado',
  cancelled: 'Solicitud Cancelada',
  price_updated: 'Precio Actualizado',
  location_updated: 'Ubicacion Actualizada',
};

export default function MopRequestsPage() {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [auditTrail, setAuditTrail] = useState<AuditEvent[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  useEffect(() => {
    const fetchRequests = async () => {
      const supabase = createClient();

      let query = supabase
        .from('service_requests')
        .select(`
          id,
          status,
          tow_type,
          incident_type,
          pickup_address,
          dropoff_address,
          total_price,
          distance_km,
          created_at,
          completed_at,
          profiles!service_requests_user_id_fkey (full_name, email),
          providers (name),
          operator:profiles!service_requests_operator_id_fkey (full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data } = await query;

      const mappedRequests = (data || []).map((r) => ({
        id: r.id,
        status: r.status,
        tow_type: r.tow_type,
        incident_type: r.incident_type,
        pickup_address: r.pickup_address,
        dropoff_address: r.dropoff_address,
        total_price: r.total_price,
        distance_km: r.distance_km,
        created_at: r.created_at,
        completed_at: r.completed_at,
        user_name: (r.profiles as unknown as { full_name: string; email: string } | null)?.full_name || null,
        user_email: (r.profiles as unknown as { full_name: string; email: string } | null)?.email || null,
        provider_name: (r.providers as unknown as { name: string } | null)?.name || null,
        operator_name: (r.operator as unknown as { full_name: string } | null)?.full_name || null,
      })) as ServiceRequest[];

      setRequests(mappedRequests);
      setLoading(false);
    };
    fetchRequests();
  }, [statusFilter]);

  const fetchAuditTrail = async (requestId: string) => {
    setLoadingAudit(true);
    const supabase = createClient();

    // Use RPC to get audit trail with user names
    const { data } = await supabase.rpc('get_request_audit_trail', {
      p_request_id: requestId,
    });

    setAuditTrail((data as AuditEvent[]) || []);
    setLoadingAudit(false);
  };

  const handleViewDetails = async (request: ServiceRequest) => {
    setSelectedRequest(request);
    await fetchAuditTrail(request.id);
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
          Solicitudes de Servicio
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Historial y auditoria de servicios de grua
        </p>
      </div>

      {/* Status Filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        {['all', 'initiated', 'assigned', 'en_route', 'active', 'completed', 'cancelled'].map(
          (status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                statusFilter === status
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              {status === 'all' ? 'Todas' : STATUS_LABELS[status]}
            </button>
          )
        )}
      </div>

      {/* Detail Modal */}
      {selectedRequest && (
        <RequestDetailModal
          request={selectedRequest}
          auditTrail={auditTrail}
          loadingAudit={loadingAudit}
          onClose={() => setSelectedRequest(null)}
        />
      )}

      {/* Requests Table */}
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Usuario
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Tipo
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Incidente
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Estado
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Proveedor
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Precio
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Fecha
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-sm text-zinc-500">
                    Cargando...
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    No hay solicitudes registradas
                  </td>
                </tr>
              ) : (
                requests.map((request) => (
                  <tr key={request.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-mono text-zinc-900 dark:text-white">
                      {request.id.substring(0, 8)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div>
                        <p className="text-sm text-zinc-900 dark:text-white">
                          {request.user_name || 'Sin nombre'}
                        </p>
                        <p className="text-xs text-zinc-500">{request.user_email}</p>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {request.tow_type === 'light' ? 'Liviana' : 'Pesada'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {request.incident_type}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[request.status] || STATUS_COLORS.initiated}`}
                      >
                        {STATUS_LABELS[request.status] || request.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {request.provider_name || '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {request.total_price ? `$${request.total_price.toFixed(2)}` : '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {new Date(request.created_at).toLocaleDateString('es-SV')}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      <button
                        onClick={() => handleViewDetails(request)}
                        className="text-emerald-600 hover:text-emerald-800 dark:text-emerald-400"
                      >
                        Ver Detalle
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RequestDetailModal({
  request,
  auditTrail,
  loadingAudit,
  onClose,
}: {
  request: ServiceRequest;
  auditTrail: AuditEvent[];
  loadingAudit: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            Detalle de Solicitud
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-6 w-6"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {/* Request Info */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">ID Solicitud</p>
              <p className="font-mono text-sm text-zinc-900 dark:text-white">{request.id}</p>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Estado</p>
              <span
                className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[request.status]}`}
              >
                {STATUS_LABELS[request.status]}
              </span>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Usuario</p>
              <p className="text-sm text-zinc-900 dark:text-white">{request.user_name || 'N/A'}</p>
              <p className="text-xs text-zinc-500">{request.user_email}</p>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Tipo de Grua</p>
              <p className="text-sm text-zinc-900 dark:text-white">
                {request.tow_type === 'light' ? 'Liviana' : 'Pesada'}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Tipo de Incidente</p>
              <p className="text-sm text-zinc-900 dark:text-white">{request.incident_type}</p>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Proveedor / Operador</p>
              <p className="text-sm text-zinc-900 dark:text-white">
                {request.provider_name || '-'}
              </p>
              <p className="text-xs text-zinc-500">{request.operator_name || ''}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Direccion de Recogida</p>
              <p className="text-sm text-zinc-900 dark:text-white">{request.pickup_address}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Direccion de Destino</p>
              <p className="text-sm text-zinc-900 dark:text-white">{request.dropoff_address}</p>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Distancia</p>
              <p className="text-sm text-zinc-900 dark:text-white">
                {request.distance_km ? `${request.distance_km.toFixed(1)} km` : '-'}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Precio Total</p>
              <p className="text-lg font-bold text-zinc-900 dark:text-white">
                {request.total_price ? `$${request.total_price.toFixed(2)}` : '-'}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Creada</p>
              <p className="text-sm text-zinc-900 dark:text-white">
                {new Date(request.created_at).toLocaleString('es-SV')}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Completada</p>
              <p className="text-sm text-zinc-900 dark:text-white">
                {request.completed_at
                  ? new Date(request.completed_at).toLocaleString('es-SV')
                  : '-'}
              </p>
            </div>
          </div>

          {/* Audit Trail */}
          <div className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
            <h3 className="mb-4 text-md font-semibold text-zinc-900 dark:text-white">
              Historial de Eventos (Auditoria)
            </h3>

            {loadingAudit ? (
              <p className="text-sm text-zinc-500">Cargando historial...</p>
            ) : auditTrail.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay eventos registrados</p>
            ) : (
              <div className="space-y-4">
                {auditTrail.map((event, index) => (
                  <div key={event.id} className="relative flex gap-4">
                    {/* Timeline line */}
                    {index < auditTrail.length - 1 && (
                      <div className="absolute left-[11px] top-6 h-full w-0.5 bg-zinc-200 dark:bg-zinc-700" />
                    )}
                    {/* Timeline dot */}
                    <div className="relative z-10 mt-1.5 h-3 w-3 flex-shrink-0 rounded-full bg-emerald-500" />
                    {/* Event content */}
                    <div className="flex-1 pb-4">
                      <p className="text-sm font-medium text-zinc-900 dark:text-white">
                        {EVENT_LABELS[event.event_type] || event.event_type}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {new Date(event.created_at).toLocaleString('es-SV')}
                        {event.actor_name && ` - ${event.actor_name}`}
                        {event.actor_role && ` (${event.actor_role})`}
                      </p>
                      {event.payload && Object.keys(event.payload).length > 0 && (
                        <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
