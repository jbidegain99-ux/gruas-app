'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, ClipboardList, DollarSign, Moon, Timer, Truck, type LucideIcon } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { duration, formatDate, money } from '@/shared/lib/format';
import { MonthBars } from './MonthBars';
import { accountUrl, monthLabel, pct, pctChange, type AccountKind } from './account-360';

// Dashboard de negocio (migr. 00105): la plataforma en conjunto, 6 meses.
// El dashboard de /admin es el operativo del día; este es el de tendencias.
// Las definiciones están al pie de la página y en la migración: el spec de
// super admin documenta tres bugs por no escribirlas.

type Month = {
  month: string;
  created: number;
  completed: number;
  cancelled: number;
  gross: number;
  commission: number;
  mopt_fee: number;
  revenue: number;
  coverage: number;
};

type AccountGroup = {
  active: number;
  engaged: number;
  dormant: { id: string; name: string; last_at: string | null }[];
};

type Business = {
  months: Month[];
  accounts: Partial<Record<AccountKind, AccountGroup>>;
  operators: { approved: number; engaged: number; online_now: number; pending: number };
  sla_30d: {
    n: number;
    avg_assignment_seconds: number | null;
    avg_arrival_seconds: number | null;
    assignment_met_pct: number | null;
    arrival_met_pct: number | null;
  };
  cancel_rate_30d: number | null;
  top_providers_month: { id: string; name: string; completed: number; gross: number }[];
};

const ACCOUNT_GROUPS: { kind: AccountKind; label: string }[] = [
  { kind: 'provider', label: 'Empresas proveedoras' },
  { kind: 'insurer', label: 'Aseguradoras' },
  { kind: 'mopt', label: 'Programas MOPT' },
];

const card = 'rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900';

export default function AdminBusinessPage() {
  const [data, setData] = useState<Business | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .rpc('admin_business_dashboard')
      .then(({ data: res, error: rpcError }) => {
        setError(rpcError?.message ?? null);
        setData((res as unknown as Business) ?? null);
      });
  }, []);

  if (error) {
    return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">No se pudo cargar: {error}</p>;
  }
  if (!data) return <p className="text-sm text-zinc-500">Cargando…</p>;

  const months = data.months;
  const cur = months.at(-1)!;
  const prev = months.at(-2);
  const currentMonth = cur.month.slice(0, 10);
  const series = (f: (m: Month) => number) => months.map((m) => ({ month: m.month, value: Number(f(m)) }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Negocio</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Cómo va la plataforma en los últimos 6 meses. Para el día a día, el{' '}
          <Link href="/admin" className="underline">Dashboard</Link>.
        </p>
      </div>

      {/* KPIs: mes en curso contra el anterior */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label={`Ingreso de Budi · ${monthLabel(cur.month)}`}
          value={money(cur.revenue)}
          change={prev ? pctChange(Number(cur.revenue), Number(prev.revenue)) : null}
          sub={`comisión ${money(cur.commission)} · tarifa MOPT ${money(cur.mopt_fee)}`}
          Icon={DollarSign}
        />
        <Kpi
          label={`Facturado (bruto) · ${monthLabel(cur.month)}`}
          value={money(cur.gross)}
          change={prev ? pctChange(Number(cur.gross), Number(prev.gross)) : null}
          sub={`cobertura a aseguradoras ${money(cur.coverage)}`}
          Icon={ClipboardList}
        />
        <Kpi
          label={`Servicios completados · ${monthLabel(cur.month)}`}
          value={String(cur.completed)}
          change={prev ? pctChange(Number(cur.completed), Number(prev.completed)) : null}
          sub={`${cur.created} creados · ${cur.cancelled} cancelados`}
          Icon={Truck}
        />
        <Kpi
          label="SLA · últimos 30 días"
          value={pct(data.sla_30d.assignment_met_pct)}
          sub={`asignación a tiempo · llegada ${pct(data.sla_30d.arrival_met_pct)} · ${data.sla_30d.n} servicios`}
          Icon={Timer}
        />
      </div>

      {/* Tendencias: una métrica por gráfico (nunca dos ejes) */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <MonthBars title="Ingreso de Budi por mes" data={series((m) => m.revenue)} format={money} currentMonth={currentMonth} />
        <MonthBars title="Facturado (bruto) por mes" data={series((m) => m.gross)} format={money} currentMonth={currentMonth} />
        <MonthBars
          title="Servicios completados por mes"
          data={series((m) => m.completed)}
          format={(n) => `${n} servicio${n === 1 ? '' : 's'}`}
          currentMonth={currentMonth}
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        {/* Cuentas */}
        <section className={`${card} p-5 lg:col-span-2`}>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
            <Building2 className="h-4 w-4 text-zinc-400" /> Cuentas activas
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {ACCOUNT_GROUPS.map(({ kind, label }) => {
              const g = data.accounts[kind] ?? { active: 0, engaged: 0, dormant: [] };
              return (
                <div key={kind}>
                  <p className="text-xs text-zinc-500">{label}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{g.active}</p>
                  <p className="text-xs text-zinc-500">
                    {g.engaged} con actividad · {g.dormant.length} dormida{g.dormant.length === 1 ? '' : 's'}
                  </p>
                  {g.dormant.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {g.dormant.map((d) => (
                        <li key={d.id} className="flex items-center gap-1.5 text-xs">
                          <Moon className="h-3 w-3 shrink-0 text-zinc-400" />
                          <Link href={accountUrl(kind, d.id)} className="truncate text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                            {d.name}
                          </Link>
                          <span className="shrink-0 text-zinc-400">{d.last_at ? `· ${formatDate(d.last_at)}` : '· nunca'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Operadores y calidad */}
        <section className={`${card} p-5`}>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
            <Truck className="h-4 w-4 text-zinc-400" /> Socios operadores y calidad
          </h2>
          <dl className="space-y-3 text-sm">
            <Row label="Aprobados" value={String(data.operators.approved)} sub={`${data.operators.pending} en revisión`} />
            <Row label="Con servicios en 30 días" value={String(data.operators.engaged)} />
            <Row label="En línea ahora" value={String(data.operators.online_now)} />
            <Row
              label="Asignación promedio (30 d)"
              value={data.sla_30d.avg_assignment_seconds == null ? '—' : duration(data.sla_30d.avg_assignment_seconds / 60)}
            />
            <Row
              label="Llegada promedio (30 d)"
              value={data.sla_30d.avg_arrival_seconds == null ? '—' : duration(data.sla_30d.avg_arrival_seconds / 60)}
            />
            <Row label="Cancelación (30 d)" value={pct(data.cancel_rate_30d)} sub="de las solicitudes creadas" />
          </dl>
        </section>
      </div>

      <section className={card}>
        <h2 className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold text-zinc-900 dark:border-zinc-800 dark:text-white">
          Empresas con más servicios · {monthLabel(cur.month, true)}
        </h2>
        {data.top_providers_month.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-500">Todavía no hay servicios completados este mes.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.top_providers_month.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-2">
                    <Link href={accountUrl('provider', p.id)} className="text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{p.completed} servicios</td>
                  <td className="px-5 py-2 text-right font-medium tabular-nums text-zinc-900 dark:text-white">{money(p.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <details className="mt-6 text-xs text-zinc-500">
        <summary className="cursor-pointer select-none font-medium">Cómo se calcula cada número</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Meses de El Salvador. Creados cuentan por fecha de creación; completados y todo el dinero por fecha de cierre (igual que la liquidación); cancelados por fecha de cancelación.</li>
          <li><strong>Ingreso de Budi</strong> = comisión retenida a empresas y socios operadores + tarifa de plataforma de los programas MOPT, con la tasa vigente cuando se completó cada servicio. Sale del mismo libro que Cuentas y Finanzas.</li>
          <li><strong>Cobertura a aseguradoras</strong> no es ingreso de Budi: se cobra a la aseguradora y se le paga al proveedor. Se muestra aparte.</li>
          <li><strong>Con actividad</strong> = cuenta activa con al menos un servicio completado en los últimos 30 días. <strong>Dormida</strong> = activa sin ninguno. Las dos suman el total de activas.</li>
          <li><strong>SLA</strong>: objetivo de la aseguradora que cubrió el servicio, si no 10 min para asignar y 45 para llegar. Mismo cálculo que el panel de cada caso.</li>
        </ul>
      </details>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  change,
  Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  change?: number | null;
  Icon: LucideIcon;
}) {
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{label}</p>
        <Icon className="h-4 w-4 text-zinc-400" />
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{value}</p>
      {change != null && (
        <p className="text-xs text-zinc-500">
          <span aria-hidden>{change >= 0 ? '▲' : '▼'}</span> {Math.abs(change)}% vs mes anterior completo (este va en curso)
        </p>
      )}
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-zinc-600 dark:text-zinc-400">
        {label}
        {sub && <span className="block text-xs text-zinc-400">{sub}</span>}
      </dt>
      <dd className="font-semibold tabular-nums text-zinc-900 dark:text-white">{value}</dd>
    </div>
  );
}
