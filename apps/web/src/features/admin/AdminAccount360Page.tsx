'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Clock,
  DollarSign,
  Settings,
  Star,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { duration, formatDate, money } from '@/shared/lib/format';
import { MonthBars } from './MonthBars';
import {
  ACCOUNT_KIND_LABELS,
  PERIOD_LABELS,
  pct,
  periodRange,
  type AccountKind,
  type PeriodKey,
} from './account-360';
import { auditTableLabel } from './audit-format';

// Ficha 360 de una cuenta (migr. 00105): todo lo de una empresa, aseguradora o
// programa MOPT en una sola respuesta. El dinero sale del libro de movimientos,
// así que lo que dice acá es lo mismo que dicen Cuentas y Finanzas.

type Sla = {
  n: number;
  avg_assignment_seconds: number | null;
  avg_arrival_seconds: number | null;
  assignment_met_pct: number | null;
  arrival_met_pct: number | null;
};

type Account360 = {
  account: {
    kind: AccountKind;
    id: string;
    name: string;
    is_active: boolean;
    created_at: string;
    contact_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    address?: string | null;
    tax_id?: string | null;
  };
  people: {
    operators?: number;
    approved?: number;
    pending?: number;
    online_now?: number;
    zones_active?: number | null;
    services_offered?: string[];
    plans?: number;
    policies_active?: number;
    members_active?: number;
    sla_assignment_minutes?: number;
    sla_arrival_minutes?: number;
  };
  money: {
    payout: number;
    commission: number;
    coverage: number;
    copay: number | null;
    owed_operators: number;
    platform_fee: number;
    commission_rate_now: number | null;
    next_rate_change: { rate: number | null; valid_from: string } | null;
  };
  services: {
    created: number;
    completed: number;
    cancelled: number;
    in_progress: number;
    gross: number;
    last_completed_at: string | null;
  };
  monthly: { month: string; completed: number; gross: number }[];
  sla: Sla;
  ratings: { n: number; avg: number | null };
  balances: {
    direction: 'debe' | 'le_deben';
    counterparty: string | null;
    owed: number;
    paid: number;
    balance: number;
    last_paid_on: string | null;
  }[];
  payments: {
    id: string;
    amount: number;
    paid_on: string;
    reference: string | null;
    voided: boolean;
    direction: 'pago' | 'cobro';
  }[];
  top_operators: { id: string; name: string | null; completed: number; rating: number | null }[];
  activity: {
    occurred_at: string;
    actor_name: string | null;
    table_name: string;
    action: string;
    record_label: string | null;
  }[];
};

const CONFIG_URL: Record<AccountKind, (id: string) => string> = {
  provider: () => '/admin/providers',
  insurer: (id) => `/admin/insurers/${id}`,
  mopt: () => '/admin/mopt',
};

const card = 'rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900';

export default function AdminAccount360Page({ kind, accountId }: { kind: AccountKind; accountId: string }) {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [data, setData] = useState<Account360 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { from, to } = periodRange(period);
      const { data: res, error: rpcError } = await createClient().rpc('admin_account_360', {
        p_kind: kind,
        p_id: accountId,
        p_from: from,
        p_to: to,
      });
      setError(rpcError?.message ?? null);
      setData((res as unknown as Account360) ?? null);
      setLoading(false);
    };
    load();
  }, [kind, accountId, period]);

  if (error) {
    return (
      <div>
        <BackLink />
        <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          No se pudo cargar la ficha: {error}
        </p>
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-zinc-500">Cargando…</p>;
  }

  const { account, services, money: m, sla, ratings, people } = data;
  const currentMonth = data.monthly.at(-1)?.month.slice(0, 10);

  const moneyTiles: { label: string; value: string; sub?: string; Icon: LucideIcon }[] =
    kind === 'provider'
      ? [
          { label: 'Budi retuvo', value: money(m.commission), sub: `comisión hoy: ${Number(m.commission_rate_now)}%`, Icon: DollarSign },
          { label: 'Se le liquida', value: money(m.payout), sub: 'bruto menos comisión', Icon: Wallet },
        ]
      : kind === 'insurer'
        ? [
            { label: 'Cobertura facturada', value: money(m.coverage), sub: 'lo que Budi le cobra', Icon: DollarSign },
            { label: 'Copagos de afiliados', value: money(m.copay), sub: 'lo pagó el afiliado', Icon: Wallet },
          ]
        : [
            { label: 'Debe a sus socios operadores', value: money(m.owed_operators), sub: 'servicios del periodo', Icon: Wallet },
            { label: 'Tarifa de Budi', value: money(m.platform_fee), sub: `tarifa hoy: ${Number(m.commission_rate_now)}%`, Icon: DollarSign },
          ];

  return (
    <div className={loading ? 'opacity-60 transition-opacity' : ''}>
      <BackLink />

      {/* Encabezado */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{ACCOUNT_KIND_LABELS[kind]}</p>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">
            {account.name}
            <span
              className={`ml-3 inline-flex rounded-full px-2 py-0.5 align-middle text-xs font-medium ${
                account.is_active
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                  : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              {account.is_active ? 'Activa' : 'Inactiva'}
            </span>
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {[account.contact_name, account.contact_phone, account.contact_email].filter(Boolean).join(' · ') || 'Sin contacto cargado'}
            {' · '}cliente desde {formatDate(account.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700" role="group" aria-label="Periodo">
            {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setPeriod(k)}
                aria-pressed={period === k}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  period === k
                    ? 'bg-budi-primary-500 text-white'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                {PERIOD_LABELS[k]}
              </button>
            ))}
          </div>
          <Link
            href={CONFIG_URL[kind](accountId)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Settings className="h-3.5 w-3.5" /> Configuración
          </Link>
        </div>
      </div>

      {/* KPIs del periodo */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Servicios completados"
          value={String(services.completed)}
          sub={`${services.created} creados · ${services.cancelled} cancelados${services.in_progress ? ` · ${services.in_progress} en curso ahora` : ''}`}
          Icon={ClipboardList}
        />
        <Tile label="Facturado (bruto)" value={money(services.gross)} sub="servicios completados del periodo" Icon={CheckCircle2} />
        {moneyTiles.map((t) => (
          <Tile key={t.label} {...t} />
        ))}
      </div>

      {m.next_rate_change && (
        <p className="mb-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          Cambio de tarifa programado:{' '}
          <strong>{m.next_rate_change.rate == null ? 'vuelve al default' : `${Number(m.next_rate_change.rate)}%`}</strong> desde el{' '}
          {formatDate(m.next_rate_change.valid_from)}.{' '}
          <Link href="/admin/tarifas" className="underline">Ver tarifas</Link>
        </p>
      )}

      {/* Tendencia */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <MonthBars
          title="Servicios completados por mes"
          data={data.monthly.map((x) => ({ month: x.month, value: Number(x.completed) }))}
          format={(n) => `${n} servicio${n === 1 ? '' : 's'}`}
          currentMonth={currentMonth}
        />
        <MonthBars
          title="Facturado por mes (bruto)"
          data={data.monthly.map((x) => ({ month: x.month, value: Number(x.gross) }))}
          format={money}
          currentMonth={currentMonth}
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        {/* Calidad */}
        <section className={`${card} p-5`}>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
            <Clock className="h-4 w-4 text-zinc-400" /> Calidad del servicio
          </h2>
          <dl className="space-y-3 text-sm">
            <Row
              label="Asignación promedio"
              value={sla.avg_assignment_seconds == null ? '—' : duration(sla.avg_assignment_seconds / 60)}
              sub={`${pct(sla.assignment_met_pct)} dentro del objetivo`}
            />
            <Row
              label="Llegada promedio"
              value={sla.avg_arrival_seconds == null ? '—' : duration(sla.avg_arrival_seconds / 60)}
              sub={`${pct(sla.arrival_met_pct)} dentro del objetivo`}
            />
            <Row
              label="Calificación"
              value={ratings.avg == null ? '—' : `${Number(ratings.avg).toFixed(2)} ★`}
              sub={`${ratings.n} ${ratings.n === 1 ? 'calificación' : 'calificaciones'}`}
            />
          </dl>
          <p className="mt-4 text-xs text-zinc-500">
            {sla.n} servicio{sla.n === 1 ? '' : 's'} medido{sla.n === 1 ? '' : 's'}. Objetivo: el de la aseguradora que lo cubrió, si no 10 min
            para asignar y 45 para llegar.
          </p>
        </section>

        {/* Personas */}
        <section className={`${card} p-5`}>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
            <Users className="h-4 w-4 text-zinc-400" /> {kind === 'insurer' ? 'Cartera' : 'Flota'}
          </h2>
          {kind === 'insurer' ? (
            <dl className="space-y-3 text-sm">
              <Row label="Pólizas activas" value={String(people.policies_active ?? 0)} />
              <Row label="Afiliados activos" value={String(people.members_active ?? 0)} />
              <Row label="Planes" value={String(people.plans ?? 0)} />
              <Row label="Objetivo de SLA" value={`${people.sla_assignment_minutes} / ${people.sla_arrival_minutes} min`} sub="asignación / llegada" />
            </dl>
          ) : (
            <>
              <dl className="space-y-3 text-sm">
                <Row label="Socios operadores" value={String(people.operators ?? 0)} sub={`${people.approved ?? 0} aprobados · ${people.pending ?? 0} en revisión`} />
                <Row label="En línea ahora" value={String(people.online_now ?? 0)} />
                {kind === 'mopt' && <Row label="Zonas activas" value={String(people.zones_active ?? 0)} />}
              </dl>
              {!!people.services_offered?.length && (
                <p className="mt-4 text-xs text-zinc-500">Presta: {people.services_offered.join(', ')}</p>
              )}
            </>
          )}
        </section>

        {/* Top operadores */}
        <section className={`${card} p-5`}>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
            <Star className="h-4 w-4 text-zinc-400" /> {kind === 'insurer' ? 'Actividad reciente' : 'Socios operadores del periodo'}
          </h2>
          {kind === 'insurer' ? (
            <ActivityList activity={data.activity.slice(0, 5)} />
          ) : data.top_operators.length === 0 ? (
            <p className="text-sm text-zinc-500">Sin servicios completados en el periodo.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.top_operators.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-zinc-800 dark:text-zinc-200">{o.name ?? 'Socio operador'}</span>
                  <span className="shrink-0 tabular-nums text-zinc-500">
                    {o.completed} · {o.rating == null ? '—' : `${Number(o.rating).toFixed(1)} ★`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Libro */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold text-zinc-900 dark:border-zinc-800 dark:text-white">
            Saldos hoy
          </h2>
          {data.balances.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-500">Sin movimientos en el libro.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Con</th>
                  <th className="px-5 py-2 text-right font-medium">Generado</th>
                  <th className="px-5 py-2 text-right font-medium">Pagado</th>
                  <th className="px-5 py-2 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.balances.map((b, i) => (
                  <tr key={i}>
                    <td className="px-5 py-2 text-zinc-800 dark:text-zinc-200">
                      {b.direction === 'debe' ? `Le debe a ${b.counterparty ?? '—'}` : `${b.counterparty ?? '—'} le debe`}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{money(b.owed)}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{money(b.paid)}</td>
                    <td className="px-5 py-2 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">{money(b.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="px-5 pb-3 pt-1 text-xs text-zinc-500">
            Desde siempre, no solo del periodo. <Link href="/admin/cuentas" className="underline">Registrar un pago</Link>
          </p>
        </section>

        <section className={card}>
          <h2 className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold text-zinc-900 dark:border-zinc-800 dark:text-white">
            Últimos pagos
          </h2>
          {data.payments.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-500">Todavía no hay pagos registrados.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {data.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {formatDate(p.paid_on)} · {p.direction === 'pago' ? 'Pagó' : 'Recibió'}
                    {p.reference ? ` · ${p.reference}` : ''}
                  </span>
                  <span className={`tabular-nums ${p.voided ? 'text-zinc-400 line-through' : 'font-medium text-zinc-900 dark:text-white'}`}>
                    {money(p.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {kind !== 'insurer' && (
        <section className={`${card} p-5`}>
          <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-white">Actividad reciente</h2>
          <ActivityList activity={data.activity} />
        </section>
      )}

      <p className="mt-6 text-xs text-zinc-500">
        Servicios creados y cancelados cuentan por su fecha de creación y cancelación; completados y dinero por la fecha de
        cierre, igual que la liquidación. Último servicio completado:{' '}
        {services.last_completed_at ? formatDate(services.last_completed_at) : 'nunca'}.
      </p>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/cuentas" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
      <ArrowLeft className="h-4 w-4" /> Cuentas
    </Link>
  );
}

function Tile({ label, value, sub, Icon }: { label: string; value: string; sub?: string; Icon: LucideIcon }) {
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{label}</p>
        <Icon className="h-4 w-4 text-zinc-400" />
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{value}</p>
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

function ActivityList({ activity }: { activity: Account360['activity'] }) {
  if (activity.length === 0) {
    return <p className="text-sm text-zinc-500">Sin cambios registrados en la bitácora.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {activity.map((a, i) => (
        <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-zinc-800 dark:text-zinc-200">
            {auditTableLabel(a.table_name)}
            {a.record_label ? ` · ${a.record_label}` : ''}
          </span>
          <span className="text-xs text-zinc-500">
            {a.actor_name ?? '—'} · {formatDate(a.occurred_at)}
          </span>
        </li>
      ))}
    </ul>
  );
}
