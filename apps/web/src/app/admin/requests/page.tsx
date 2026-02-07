'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { StatusBadge } from '@/components/StatusBadge';
import { ServiceTypeBadge } from '@/components/ServiceTypeBadge';

type ServiceRequest = {
  id: string;
  user_id: string;
  operator_id: string | null;
  tow_type: 'light' | 'heavy';
  service_type: string;
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
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const fetchRequests = async () => {
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
    };
    fetchRequests();
  }, [statusFilter, refreshKey]);

  const refetch = () => setRefreshKey((k) => k + 1);

  const handleCancelRequest = async (requestId: string) => {
    if (!confirm('Esta seguro de cancelar esta solicitud?')) return;

    const supabase = createClient();
    await supabase.rpc('admin_cancel_request', { p_request_id: requestId });
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
                          selectedRequest?.id === request.id ? 'bg-budi-primary-50 dark:bg-budi-primary-900/20' : ''
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-900 dark:text-white">
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
                  <p className="text-xs text-zinc-500">Servicio</p>
                  <ServiceTypeBadge serviceType={selectedRequest.service_type || 'tow'} />
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
