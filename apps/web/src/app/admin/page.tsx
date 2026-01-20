import { createClient } from '@/lib/supabase/server';

export default async function AdminDashboard() {
  const supabase = await createClient();

  // Fetch statistics
  const [
    { count: totalRequests },
    { count: pendingRequests },
    { count: activeRequests },
    { count: completedRequests },
    { count: totalProviders },
    { count: activeProviders },
  ] = await Promise.all([
    supabase.from('service_requests').select('*', { count: 'exact', head: true }),
    supabase.from('service_requests').select('*', { count: 'exact', head: true }).eq('status', 'initiated'),
    supabase.from('service_requests').select('*', { count: 'exact', head: true }).in('status', ['assigned', 'en_route', 'active']),
    supabase.from('service_requests').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
    supabase.from('providers').select('*', { count: 'exact', head: true }),
    supabase.from('providers').select('*', { count: 'exact', head: true }).eq('is_active', true),
  ]);

  // Fetch recent requests
  const { data: recentRequests } = await supabase
    .from('service_requests')
    .select(`
      id,
      status,
      incident_type,
      pickup_address,
      tow_type,
      created_at,
      profiles!service_requests_user_id_fkey(full_name)
    `)
    .order('created_at', { ascending: false })
    .limit(5);

  const stats = [
    { label: 'Total Solicitudes', value: totalRequests || 0, color: 'bg-blue-500' },
    { label: 'Pendientes', value: pendingRequests || 0, color: 'bg-yellow-500' },
    { label: 'En Proceso', value: activeRequests || 0, color: 'bg-green-500' },
    { label: 'Completadas', value: completedRequests || 0, color: 'bg-zinc-500' },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Vista general del sistema de gruas
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center gap-4">
              <div className={`h-12 w-12 rounded-lg ${stat.color} flex items-center justify-center`}>
                <span className="text-xl font-bold text-white">{stat.value}</span>
              </div>
              <div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Provider Stats */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            Proveedores
          </h2>
          <div className="mt-4 flex items-center gap-8">
            <div>
              <p className="text-3xl font-bold text-zinc-900 dark:text-white">
                {activeProviders || 0}
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Activos</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-zinc-900 dark:text-white">
                {totalProviders || 0}
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Total</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            Tarifa Activa
          </h2>
          <div className="mt-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Configurada desde el panel de Precios
            </p>
          </div>
        </div>
      </div>

      {/* Recent Requests */}
      <div className="mt-8">
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
              Solicitudes Recientes
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-50 dark:bg-zinc-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Usuario
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Tipo
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Ubicacion
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Estado
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Fecha
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {recentRequests && recentRequests.length > 0 ? (
                  recentRequests.map((request) => (
                    <tr key={request.id}>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-900 dark:text-white">
                        {(request.profiles as unknown as { full_name: string } | null)?.full_name || 'N/A'}
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
                        {new Date(request.created_at).toLocaleDateString('es-SV')}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                      No hay solicitudes recientes
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
