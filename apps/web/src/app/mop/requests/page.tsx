import { createClient } from '@/lib/supabase/server';

export default async function MopRequestsPage() {
  const supabase = await createClient();

  const { data: requests } = await supabase
    .from('service_requests')
    .select(`
      id,
      status,
      tow_type,
      incident_type,
      pickup_address,
      dropoff_address,
      total_price,
      created_at,
      completed_at
    `)
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
          Solicitudes
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Historial de servicios de grua
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Tipo
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Incidente
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Origen
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Estado
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Precio
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Fecha
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {requests && requests.length > 0 ? (
                requests.map((request) => (
                  <tr key={request.id}>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-900 dark:text-white">
                      {request.id.substring(0, 8)}...
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {request.tow_type === 'light' ? 'Liviana' : 'Pesada'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {request.incident_type}
                    </td>
                    <td className="max-w-xs truncate px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {request.pickup_address}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <StatusBadge status={request.status} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {request.total_price ? `$${request.total_price}` : '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {new Date(request.created_at).toLocaleDateString('es-SV')}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    No hay solicitudes registradas
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${colors[status] || colors.initiated}`}>
      {labels[status] || status}
    </span>
  );
}
