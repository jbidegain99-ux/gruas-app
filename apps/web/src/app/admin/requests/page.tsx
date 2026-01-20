'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

type ServiceRequest = {
  id: string;
  user_id: string;
  operator_id: string | null;
  tow_type: 'light' | 'heavy';
  status: string;
  pickup_address: string;
  dropoff_address: string;
  incident_type: string;
  total_price: number | null;
  created_at: string;
  profiles: { full_name: string } | null;
  operator: { full_name: string } | null;
};

export default function RequestsPage() {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);

  const fetchRequests = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .from('service_requests')
      .select(`
        *,
        profiles!service_requests_user_id_fkey(full_name),
        operator:profiles!service_requests_operator_id_fkey(full_name)
      `)
      .order('created_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    const { data } = await query.limit(50);
    setRequests(data || []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleCancelRequest = async (requestId: string) => {
    if (!confirm('Esta seguro de cancelar esta solicitud?')) return;

    const supabase = createClient();
    await supabase.rpc('admin_cancel_request', { p_request_id: requestId });
    fetchRequests();
    setSelectedRequest(null);
  };

  const exportCSV = () => {
    const headers = ['ID', 'Usuario', 'Operador', 'Tipo', 'Estado', 'Origen', 'Destino', 'Precio', 'Fecha'];
    const rows = requests.map((r) => [
      r.id,
      r.profiles?.full_name || 'N/A',
      r.operator?.full_name || 'N/A',
      r.tow_type,
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
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
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
                  ? 'bg-blue-600 text-white'
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Requests List */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-50 dark:bg-zinc-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-500">
                      Usuario
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-500">
                      Tipo
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-500">
                      Estado
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-500">
                      Precio
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-500">
                      Fecha
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">
                        Cargando...
                      </td>
                    </tr>
                  ) : requests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">
                        No hay solicitudes
                      </td>
                    </tr>
                  ) : (
                    requests.map((request) => (
                      <tr
                        key={request.id}
                        onClick={() => setSelectedRequest(request)}
                        className={`cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                          selectedRequest?.id === request.id ? 'bg-blue-50 dark:bg-blue-950' : ''
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-900 dark:text-white">
                          {request.profiles?.full_name || 'N/A'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                          {request.tow_type === 'light' ? 'Liviana' : 'Pesada'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusBadge status={request.status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                          {request.total_price ? `$${request.total_price}` : '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                          {new Date(request.created_at).toLocaleDateString('es-SV')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Request Details */}
        <div>
          {selectedRequest ? (
            <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">
                Detalle de Solicitud
              </h2>

              <div className="space-y-4">
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
                </div>

                <div>
                  <p className="text-xs text-zinc-500">Operador</p>
                  <p className="text-sm text-zinc-900 dark:text-white">
                    {selectedRequest.operator?.full_name || 'Sin asignar'}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-zinc-500">Incidente</p>
                  <p className="text-sm text-zinc-900 dark:text-white">
                    {selectedRequest.incident_type}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-zinc-500">Origen</p>
                  <p className="text-sm text-zinc-900 dark:text-white">
                    {selectedRequest.pickup_address}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-zinc-500">Destino</p>
                  <p className="text-sm text-zinc-900 dark:text-white">
                    {selectedRequest.dropoff_address}
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

                {!['completed', 'cancelled'].includes(selectedRequest.status) && (
                  <button
                    onClick={() => handleCancelRequest(selectedRequest.id)}
                    className="mt-4 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                  >
                    Cancelar Solicitud
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-500">
                Selecciona una solicitud para ver los detalles
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    initiated: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    assigned: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    en_route: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
    active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    completed: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };

  const labels: Record<string, string> = {
    initiated: 'Pendiente',
    assigned: 'Asignada',
    en_route: 'En Camino',
    active: 'Activa',
    completed: 'Completada',
    cancelled: 'Cancelada',
  };

  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${colors[status]}`}>
      {labels[status] || status}
    </span>
  );
}
