import { DollarSign, CalendarDays, CheckCircle2, Receipt } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/server';
import { money } from '@/shared/lib/format';

type Row = {
  total_price: number | null;
  created_at: string;
  completed_at: string | null;
  operator_id: string | null;
  provider_id: string | null;
  operator: { full_name: string } | null;
  providers: { name: string } | null;
};

type Agg = { name: string; count: number; total: number };

export default async function AdminFinancePage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from('service_requests')
    .select(
      'total_price, created_at, completed_at, operator_id, provider_id, operator:profiles!service_requests_operator_id_fkey(full_name), providers(name)'
    )
    .eq('status', 'completed');

  const rows = (data || []) as unknown as Row[];

  // Server component: se renderiza por request.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartMs = monthStart.getTime();

  const total = rows.reduce((a, r) => a + (r.total_price || 0), 0);
  const count = rows.length;
  const avg = count ? total / count : 0;
  const monthTotal = rows
    .filter((r) => new Date(r.completed_at || r.created_at).getTime() >= monthStartMs)
    .reduce((a, r) => a + (r.total_price || 0), 0);

  const groupBy = (keyOf: (r: Row) => string, nameOf: (r: Row) => string): Agg[] => {
    const m = new Map<string, Agg>();
    for (const r of rows) {
      const k = keyOf(r);
      const cur = m.get(k) || { name: nameOf(r), count: 0, total: 0 };
      cur.count += 1;
      cur.total += r.total_price || 0;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };

  const operators = groupBy(
    (r) => r.operator_id || 'none',
    (r) => r.operator?.full_name || 'Sin operador'
  );
  const providers = groupBy(
    (r) => r.provider_id || 'none',
    (r) => r.providers?.name || 'Sin proveedor'
  );

  const kpis = [
    { label: 'Ingresos totales', value: money(total), sub: `${count} servicios completados`, Icon: DollarSign, tint: 'bg-budi-accent-50 text-budi-accent-600 dark:bg-budi-accent-900/40 dark:text-budi-accent-300' },
    { label: 'Ingresos del mes', value: money(monthTotal), sub: 'servicios completados este mes', Icon: CalendarDays, tint: 'bg-budi-primary-50 text-budi-primary-600 dark:bg-budi-primary-900/40 dark:text-budi-primary-300' },
    { label: 'Servicios completados', value: String(count), sub: 'histórico', Icon: CheckCircle2, tint: 'bg-green-50 text-green-600 dark:bg-green-900/40 dark:text-green-300' },
    { label: 'Ticket promedio', value: money(avg), sub: 'por servicio', Icon: Receipt, tint: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Finanzas</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Ingresos por servicios completados y desglose por operador y proveedor
        </p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{k.label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{k.value}</p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${k.tint}`}>
                <k.Icon className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Por operador */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Cobrado por operador</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Monto facturado por sus servicios completados (sin comisiones/liquidación aún).</p>
        </div>
        <FinTable rows={operators} firstHeader="Operador" total={total} />
      </div>

      {/* Por proveedor */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Ingresos por proveedor</h2>
        </div>
        <FinTable rows={providers} firstHeader="Proveedor" total={total} />
      </div>
    </div>
  );
}

function FinTable({ rows, firstHeader, total }: { rows: Agg[]; firstHeader: string; total: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-zinc-50 dark:bg-zinc-800/60">
          <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <th className="px-5 py-3 font-medium">{firstHeader}</th>
            <th className="px-5 py-3 text-right font-medium">Servicios</th>
            <th className="px-5 py-3 text-right font-medium">Total cobrado</th>
            <th className="px-5 py-3 text-right font-medium">Ticket prom.</th>
            <th className="px-5 py-3 font-medium">% del total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-10 text-center text-sm text-zinc-500">
                Aún no hay servicios completados.
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const pct = total > 0 ? (r.total / total) * 100 : 0;
              return (
                <tr key={r.name} className="text-sm">
                  <td className="whitespace-nowrap px-5 py-3 font-medium text-zinc-900 dark:text-white">{r.name}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{r.count}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">{money(r.total)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {money(r.count ? r.total / r.count : 0)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className="h-full rounded-full bg-budi-primary-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="tabular-nums text-xs text-zinc-500">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
