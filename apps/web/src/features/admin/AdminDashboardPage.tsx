import Link from 'next/link';
import {
  ClipboardList,
  Activity,
  Timer,
  DollarSign,
  Radio,
  ShieldAlert,
  Building2,
  ArrowRight,
  UserCheck,
  MapPin,
  Wrench,
} from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/server';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { ServiceTypeBadge } from '@/shared/components/ServiceTypeBadge';
import { DashboardLiveRefresh } from './DashboardLiveRefresh';
import { duration, money } from '@/shared/lib/format';

const STATUSES = ['initiated', 'assigned', 'en_route', 'active', 'completed', 'cancelled'] as const;

const STATUS_META: Record<string, { label: string; bar: string }> = {
  initiated: { label: 'Pendientes', bar: 'bg-yellow-400' },
  assigned: { label: 'Asignadas', bar: 'bg-budi-primary-400' },
  en_route: { label: 'En Camino', bar: 'bg-indigo-400' },
  active: { label: 'Activas', bar: 'bg-green-400' },
  completed: { label: 'Completadas', bar: 'bg-zinc-400' },
  cancelled: { label: 'Canceladas', bar: 'bg-red-400' },
};

/** Minutos transcurridos entre dos timestamps ISO; null si falta alguno o el orden es inválido. */
function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const diff = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(diff) || diff < 0) return null;
  return diff / 60000;
}

/** Promedio y mediana (en minutos) de una muestra, ignorando huecos. */
function summarize(samples: (number | null)[]): { avg: number; median: number; n: number } | null {
  const values = samples.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  return {
    avg: values.reduce((a, v) => a + v, 0) / values.length,
    median: values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid],
    n: values.length,
  };
}


export default async function AdminDashboardPage() {
  const supabase = await createClient();
  // Soporte ve la operacion, no los ingresos (00104).
  const { data: role } = await supabase.rpc('auth_user_role');
  const showMoney = role === 'ADMIN';

  // Server component: se renderiza por request, así que la hora actual es válida.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  // "Hoy" es el de El Salvador, no el del proceso. `setHours(0,0,0,0)` usaba la
  // zona de Node: en la máquina de desarrollo coincide, pero en el VPS (UTC) el
  // día habría arrancado a las 18:00 del día anterior y el conteo de "solicitudes
  // hoy" saldría mal todas las noches. Misma raíz que la migración 00082.
  // El Salvador no tiene horario de verano, así que -06:00 vale todo el año.
  const diaSV = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(now);
  const todayIso = `${diaSV}T00:00:00-06:00`;
  // Semana en curso: lunes 00:00 (es-SV arranca la semana en lunes). El
  // retroceso se hace sobre la fecha calendario en UTC —no sobre un instante—
  // para que no se cuele el desfase al restar días.
  const cal = new Date(`${diaSV}T00:00:00Z`);
  cal.setUTCDate(cal.getUTCDate() - ((cal.getUTCDay() + 6) % 7));
  const weekIso = `${cal.toISOString().slice(0, 10)}T00:00:00-06:00`;
  const freshIso = new Date(now - 5 * 60 * 1000).toISOString();
  // Ventana de SLA: 30 días, para tener muestra suficiente aunque el volumen sea bajo.
  const slaWindowIso = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    statusCountResults,
    { count: requestsToday },
    { count: requestsWeek },
    { count: totalOperators },
    { count: operatorsOnline },
    { count: pendingVerifications },
    { count: activeProviders },
    { data: completedRows },
    { data: slaRows },
    { data: recentRequests },
  ] = await Promise.all([
    Promise.all(
      STATUSES.map((s) =>
        supabase.from('service_requests').select('id', { count: 'exact', head: true }).eq('status', s)
      )
    ),
    supabase.from('service_requests').select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
    supabase.from('service_requests').select('id', { count: 'exact', head: true }).gte('created_at', weekIso),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'OPERATOR'),
    supabase
      .from('operator_locations')
      .select('operator_id', { count: 'exact', head: true })
      .eq('is_online', true)
      .gt('updated_at', freshIso),
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'OPERATOR')
      .eq('verification_status', 'pending'),
    supabase.from('providers').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('service_requests').select('total_price, completed_at').eq('status', 'completed'),
    supabase
      .from('service_requests')
      .select('created_at, assigned_at, activated_at, completed_at')
      .gte('created_at', slaWindowIso),
    supabase
      .from('service_requests')
      .select('id, status, pickup_address, service_type, total_price, created_at, profiles!service_requests_user_id_fkey(full_name)')
      .order('created_at', { ascending: false })
      .limit(6),
  ]);

  const counts: Record<string, number> = {};
  STATUSES.forEach((s, i) => {
    counts[s] = statusCountResults[i].count || 0;
  });
  const totalRequests = STATUSES.reduce((a, s) => a + counts[s], 0);
  const activeNow = counts.assigned + counts.en_route + counts.active;
  const completed = completedRows || [];
  const revenue = completed.reduce((a, r) => a + (r.total_price || 0), 0);
  const revenueToday = completed
    .filter((r) => r.completed_at && r.completed_at >= todayIso)
    .reduce((a, r) => a + (r.total_price || 0), 0);
  const revenueWeek = completed
    .filter((r) => r.completed_at && r.completed_at >= weekIso)
    .reduce((a, r) => a + (r.total_price || 0), 0);
  const nonZeroStatuses = STATUSES.filter((s) => counts[s] > 0);

  // Tiempos de operación (SLA). `activated_at` = verificación del PIN en sitio,
  // el proxy más cercano a "llegada" que tenemos hoy.
  const sla = slaRows || [];
  const toAssign = summarize(sla.map((r) => minutesBetween(r.created_at, r.assigned_at)));
  const toArrive = summarize(sla.map((r) => minutesBetween(r.assigned_at, r.activated_at)));
  const toFinish = summarize(sla.map((r) => minutesBetween(r.activated_at, r.completed_at)));

  const kpis = [
    {
      label: 'Solicitudes hoy',
      value: requestsToday || 0,
      sub: `${requestsWeek || 0} esta semana · ${totalRequests} en total`,
      Icon: ClipboardList,
      tint: 'bg-budi-primary-50 text-budi-primary-600 dark:bg-budi-primary-900/40 dark:text-budi-primary-300',
    },
    {
      label: 'Activas ahora',
      value: activeNow,
      sub: `${counts.initiated} esperando socio operador`,
      Icon: Activity,
      tint: 'bg-green-50 text-green-600 dark:bg-green-900/40 dark:text-green-300',
    },
    {
      money: true,
      label: 'Ingresos hoy',
      value: money(revenueToday),
      sub: `${money(revenueWeek)} esta semana · ${money(revenue)} histórico`,
      Icon: DollarSign,
      tint: 'bg-budi-accent-50 text-budi-accent-600 dark:bg-budi-accent-900/40 dark:text-budi-accent-300',
    },
    {
      label: 'Tiempo de respuesta',
      value: toAssign ? duration(toAssign.avg) : '—',
      sub: toAssign
        ? `promedio solicitud → asignación (${toAssign.n} servicios)`
        : 'sin datos en los últimos 30 días',
      Icon: Timer,
      tint: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300',
    },
  ];

  const slaTiles = [
    {
      label: 'Solicitud → Asignación',
      hint: 'cuánto tarda en encontrar socio operador',
      stats: toAssign,
      Icon: UserCheck,
    },
    {
      label: 'Asignación → Llegada',
      hint: 'hasta verificar el PIN en sitio',
      stats: toArrive,
      Icon: MapPin,
    },
    {
      label: 'Duración del servicio',
      hint: 'de la activación al cierre',
      stats: toFinish,
      Icon: Wrench,
    },
  ];

  return (
    <div className="space-y-8">
      <DashboardLiveRefresh />
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Vista general de la operación
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          <Radio className="h-3.5 w-3.5 text-green-500" />
          {operatorsOnline || 0} socio{(operatorsOnline || 0) === 1 ? '' : 's'} en línea
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.filter((k) => showMoney || !('money' in k)).map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{k.label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">
                  {k.value}
                </p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${k.tint}`}>
                <k.Icon className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Tiempos de operación (SLA) */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Tiempos de operación</h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-500">últimos 30 días</span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {slaTiles.map((t) => (
            <div
              key={t.label}
              className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-800/40"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                <t.Icon className="h-3.5 w-3.5" /> {t.label}
              </div>
              {t.stats ? (
                <>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">
                    {duration(t.stats.avg)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                    mediana {duration(t.stats.median)} · {t.stats.n} servicio{t.stats.n === 1 ? '' : 's'}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-2xl font-bold text-zinc-300 dark:text-zinc-700">—</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">sin datos</p>
                </>
              )}
              <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">{t.hint}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Operations row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Operators — atajo al mapa de flota */}
        <Link
          href="/admin/fleet"
          className="group rounded-xl border border-zinc-200 bg-white p-5 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            <Radio className="h-4 w-4" /> Socios operadores
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-green-600 dark:text-green-400">
                {operatorsOnline || 0}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                en línea de {totalOperators || 0}
              </span>
            </div>
            <ArrowRight className="h-4 w-4 text-zinc-400 transition group-hover:translate-x-0.5" />
          </div>
        </Link>

        {/* Pending verifications — actionable */}
        <Link
          href="/admin/users"
          className={`group rounded-xl border p-5 transition ${
            (pendingVerifications || 0) > 0
              ? 'border-amber-300 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:hover:bg-amber-900/30'
              : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            <ShieldAlert className="h-4 w-4" /> Verificaciones pendientes
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span
              className={`text-3xl font-bold tabular-nums ${
                (pendingVerifications || 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-900 dark:text-white'
              }`}
            >
              {pendingVerifications || 0}
            </span>
            <ArrowRight className="h-4 w-4 text-zinc-400 transition group-hover:translate-x-0.5" />
          </div>
        </Link>

        {/* Providers */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            <Building2 className="h-4 w-4" /> Proveedores activos
          </div>
          <div className="mt-3">
            <span className="text-3xl font-bold tabular-nums text-zinc-900 dark:text-white">
              {activeProviders || 0}
            </span>
          </div>
        </div>
      </div>

      {/* Status distribution */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Distribución de solicitudes</h2>
        {totalRequests === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Aún no hay solicitudes.</p>
        ) : (
          <>
            <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              {nonZeroStatuses.map((s) => (
                <div
                  key={s}
                  className={STATUS_META[s].bar}
                  style={{ width: `${(counts[s] / totalRequests) * 100}%` }}
                  title={`${STATUS_META[s].label}: ${counts[s]}`}
                />
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {STATUSES.map((s) => (
                <div key={s} className="flex items-center gap-2 text-sm">
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_META[s].bar}`} />
                  <span className="text-zinc-600 dark:text-zinc-400">{STATUS_META[s].label}</span>
                  <span className="font-semibold tabular-nums text-zinc-900 dark:text-white">{counts[s]}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Recent activity */}
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Actividad reciente</h2>
          <Link
            href="/admin/requests"
            className="inline-flex items-center gap-1 text-sm font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
          >
            Ver todas <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                <th className="px-5 py-3 font-medium">Usuario</th>
                <th className="px-5 py-3 font-medium">Servicio</th>
                <th className="px-5 py-3 font-medium">Ubicación</th>
                <th className="px-5 py-3 font-medium">Estado</th>
                <th className="px-5 py-3 text-right font-medium">Precio</th>
                <th className="px-5 py-3 text-right font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {recentRequests && recentRequests.length > 0 ? (
                recentRequests.map((r) => (
                  <tr key={r.id} className="text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <td className="whitespace-nowrap px-5 py-3 font-medium text-zinc-900 dark:text-white">
                      {(r.profiles as unknown as { full_name: string } | null)?.full_name || 'N/A'}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3">
                      <ServiceTypeBadge serviceType={r.service_type || 'tow'} />
                    </td>
                    <td className="max-w-[200px] truncate px-5 py-3 text-zinc-600 dark:text-zinc-400">
                      {r.pickup_address}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                      {r.total_price ? money(r.total_price) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-zinc-500 dark:text-zinc-500">
                      {new Date(r.created_at).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-zinc-500">
                    No hay solicitudes recientes
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
