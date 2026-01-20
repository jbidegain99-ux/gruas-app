import { createClient } from '@/lib/supabase/server';

export default async function MopDashboard() {
  const supabase = await createClient();

  // Fetch statistics
  const [
    { count: totalRequests },
    { count: pendingRequests },
    { count: activeRequests },
    { count: completedRequests },
    { count: cancelledRequests },
  ] = await Promise.all([
    supabase.from('service_requests').select('*', { count: 'exact', head: true }),
    supabase.from('service_requests').select('*', { count: 'exact', head: true }).eq('status', 'initiated'),
    supabase.from('service_requests').select('*', { count: 'exact', head: true }).in('status', ['assigned', 'en_route', 'active']),
    supabase.from('service_requests').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
    supabase.from('service_requests').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),
  ]);

  // Calculate completion rate
  const total = totalRequests || 0;
  const completed = completedRequests || 0;
  const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0';

  // Fetch recent completed requests for average time calculation
  const { data: recentCompleted } = await supabase
    .from('service_requests')
    .select('created_at, completed_at')
    .eq('status', 'completed')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(100);

  let avgResponseTime = 'N/A';
  if (recentCompleted && recentCompleted.length > 0) {
    const times = recentCompleted.map((r) => {
      const start = new Date(r.created_at).getTime();
      const end = new Date(r.completed_at!).getTime();
      return (end - start) / 1000 / 60; // minutes
    });
    const avgMinutes = times.reduce((a, b) => a + b, 0) / times.length;
    avgResponseTime = avgMinutes < 60
      ? `${Math.round(avgMinutes)} min`
      : `${(avgMinutes / 60).toFixed(1)} hrs`;
  }

  const stats = [
    { label: 'Total Servicios', value: total, color: 'bg-blue-500' },
    { label: 'Pendientes', value: pendingRequests || 0, color: 'bg-yellow-500' },
    { label: 'En Proceso', value: activeRequests || 0, color: 'bg-green-500' },
    { label: 'Completados', value: completed, color: 'bg-emerald-500' },
    { label: 'Cancelados', value: cancelledRequests || 0, color: 'bg-red-500' },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
          Dashboard MOP
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Vista general de servicios de grua en El Salvador
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
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

      {/* Performance Metrics */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            Tasa de Completacion
          </h2>
          <div className="mt-4">
            <p className="text-4xl font-bold text-emerald-600">
              {completionRate}%
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              de servicios completados exitosamente
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            Tiempo Promedio de Servicio
          </h2>
          <div className="mt-4">
            <p className="text-4xl font-bold text-blue-600">
              {avgResponseTime}
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              desde solicitud hasta completar
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            Servicios Activos Ahora
          </h2>
          <div className="mt-4">
            <p className="text-4xl font-bold text-green-600">
              {activeRequests || 0}
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              en proceso en este momento
            </p>
          </div>
        </div>
      </div>

      {/* Info Card */}
      <div className="mt-8 rounded-lg border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-800 dark:bg-emerald-950">
        <h2 className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
          Sobre este Portal
        </h2>
        <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-200">
          Este portal proporciona visibilidad sobre los servicios de grua en El Salvador.
          El MOP recibe notificaciones automaticas via WhatsApp cuando se completan servicios.
          Para reportes detallados, contacte al administrador del sistema.
        </p>
      </div>
    </div>
  );
}
