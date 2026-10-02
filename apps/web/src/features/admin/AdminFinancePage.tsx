import Link from 'next/link';
import { DollarSign, ShieldCheck, Wallet, Receipt, AlertTriangle, Landmark } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/server';
import { getPlatformFeatures } from '@/shared/lib/platform-features';
import { money } from '@/shared/lib/format';
import { fetchAll } from '@/shared/lib/fetch-all';
import { FinanceExportButton } from './FinanceExportButton';
import { SettlementExportButton } from './SettlementExportButton';

type Row = {
  total_price: number | null;
  completed_at: string | null;
  operator_id: string | null;
  provider_id: string | null;
  operator: { full_name: string } | null;
  providers: { name: string } | null;
};

type Agg = { name: string; count: number; total: number };

type Resumen = {
  servicios: number;
  sin_precio: number;
  bruto: number;
  aseguradoras: number;
  copagos: number;
  particulares: number;
  /** 00098: lo que pagan los programas MOPT; el usuario no paga. */
  mopt: number;
  ticket_promedio: number;
};

type Liquidacion = {
  provider_id: string | null;
  destinatario: string;
  es_independiente: boolean;
  /** null = en el periodo rigieron tasas distintas (tarifas versionadas, 00102). */
  comision_pct: number | null;
  servicios: number;
  sin_precio: number;
  bruto: number;
  comision: number;
  a_pagar: number;
  /** 00133 (LAN-07): lo que el Usuario ya le pagó en efectivo al socio. */
  efectivo: number;
  /** a_pagar − efectivo. Negativo = el socio le debe la comisión a Budi. */
  saldo: number;
};

type PorAseguradora = {
  insurer_id: string;
  aseguradora: string;
  servicios: number;
  a_facturar: number;
  copagos: number;
  bruto: number;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** El día después de una fecha 'YYYY-MM-DD', para usarla como borde superior. */
const diaSiguiente = (f: string) => iso(new Date(new Date(f + 'T00:00:00Z').getTime() + 86400000));

/** Rangos de uso frecuente al cerrar un mes. */
function periodos(hoy: Date) {
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const inicioMesPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const finMesPasado = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  return [
    { etiqueta: 'Este mes', desde: iso(inicioMes), hasta: iso(hoy) },
    { etiqueta: 'Mes pasado', desde: iso(inicioMesPasado), hasta: iso(finMesPasado) },
    { etiqueta: 'Este año', desde: iso(new Date(hoy.getFullYear(), 0, 1)), hasta: iso(hoy) },
    { etiqueta: 'Todo', desde: '2020-01-01', hasta: iso(hoy) },
  ];
}

export default async function AdminFinancePage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const sp = await searchParams;
  // Server component: se renderiza por request, asi que `new Date()` da la fecha
  // de la peticion y no queda horneada en el build.
  const hoy = new Date();
  const rangos = periodos(hoy);
  // Por defecto, el mes en curso: es el corte con el que se trabaja a diario.
  const desde = sp.desde || rangos[0].desde;
  const hasta = sp.hasta || rangos[0].hasta;

  const supabase = await createClient();
  // Aseguradoras en pausa (00153): sin KPI, tabla ni columnas de aseguradoras.
  const { insurers } = await getPlatformFeatures(supabase);

  const [{ data: resumenRaw }, { data: porAseguradoraRaw }, { data: liquidacionRaw }, { data: filasRaw }] = await Promise.all([
    supabase.rpc('admin_finance_summary', { p_from: desde, p_to: hasta }),
    insurers
      ? supabase.rpc('admin_finance_by_insurer', { p_from: desde, p_to: hasta })
      : Promise.resolve({ data: [] as PorAseguradora[] }),
    supabase.rpc('admin_settlement_by_provider', { p_from: desde, p_to: hasta }),
    // El desglose por operador y por proveedor sigue saliendo de la tabla: son
    // agregados simples y no necesitan una RPC propia. Pero el corte tiene que
    // ser EL MISMO que el de las funciones o los totales de las tablas no
    // cerrarían contra los KPI: se mandan los bordes con el desfase de El
    // Salvador (-06:00, sin horario de verano), porque `completed_at` es
    // timestamptz y comparar contra una fecha pelada la interpreta en UTC —
    // el bug que arregló la migración 00082.
    // Por tandas: con más de 1000 servicios en el período (max_rows) las tablas
    // se quedaban cortas y no cerraban contra los KPI.
    fetchAll((from, to) =>
      supabase
        .from('service_requests')
        .select(
          'total_price, completed_at, operator_id, provider_id, operator:profiles!service_requests_operator_id_fkey(full_name), providers(name)'
        )
        .eq('status', 'completed')
        .gte('completed_at', `${desde}T00:00:00-06:00`)
        .lt('completed_at', `${diaSiguiente(hasta)}T00:00:00-06:00`)
        .order('completed_at')
        .order('id')
        .range(from, to)
    ),
  ]);

  const r = (resumenRaw as Resumen | null) ?? {
    servicios: 0, sin_precio: 0, bruto: 0, aseguradoras: 0, copagos: 0, particulares: 0, mopt: 0, ticket_promedio: 0,
  };
  const porAseguradora = (porAseguradoraRaw as PorAseguradora[] | null) ?? [];
  const liquidacion = (liquidacionRaw as Liquidacion[] | null) ?? [];
  const totalAPagar = liquidacion.reduce((a, l) => a + Number(l.a_pagar), 0);
  const totalEfectivo = liquidacion.reduce((a, l) => a + Number(l.efectivo ?? 0), 0);
  const totalComision = liquidacion.reduce((a, l) => a + Number(l.comision), 0);
  const rows = (filasRaw || []) as unknown as Row[];
  const alCliente = Number(r.copagos) + Number(r.particulares);

  const groupBy = (keyOf: (r: Row) => string, nameOf: (r: Row) => string): Agg[] => {
    const m = new Map<string, Agg>();
    for (const row of rows) {
      const k = keyOf(row);
      const cur = m.get(k) || { name: nameOf(row), count: 0, total: 0 };
      cur.count += 1;
      cur.total += row.total_price || 0;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };

  const operators = groupBy((x) => x.operator_id || 'none', (x) => x.operator?.full_name || 'Sin socio operador');
  const providers = groupBy((x) => x.provider_id || 'none', (x) => x.providers?.name || 'Sin proveedor');

  const kpis = [
    {
      label: 'Facturado (bruto)', value: money(Number(r.bruto)),
      sub: `${r.servicios} servicios · ticket ${money(Number(r.ticket_promedio))} sobre los cobrados`,
      Icon: DollarSign,
      tint: 'bg-budi-accent-50 text-budi-accent-600 dark:bg-budi-accent-900/40 dark:text-budi-accent-300',
    },
    insurers ? {
      label: 'A facturar a aseguradoras', value: money(Number(r.aseguradoras)),
      sub: Number(r.mopt) > 0
        ? `lo que asumen las pólizas · ${money(Number(r.mopt))} más los paga el MOPT a su flota`
        : 'lo que asumen las pólizas',
      Icon: ShieldCheck,
      tint: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
    } : {
      label: 'Programas MOPT', value: money(Number(r.mopt)),
      sub: 'lo paga el MOPT a su flota',
      Icon: Landmark,
      tint: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
    },
    {
      label: 'Cobrado a Usuarios', value: money(alCliente),
      sub: insurers
        ? `${money(Number(r.copagos))} de copagos · ${money(Number(r.particulares))} de particulares`
        : 'lo pagaron los Usuarios',
      Icon: Wallet,
      tint: 'bg-budi-primary-50 text-budi-primary-600 dark:bg-budi-primary-900/40 dark:text-budi-primary-300',
    },
    {
      label: 'Servicios completados', value: String(r.servicios),
      sub: 'en el periodo',
      Icon: Receipt,
      tint: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Finanzas</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Servicios completados entre el {desde} y el {hasta}, y cómo se reparte lo facturado.
          </p>
        </div>
        <FinanceExportButton desde={desde} hasta={hasta} insurers={insurers} />
      </div>

      {/* Periodo. Es un form GET a propósito: el rango queda en la URL, así que
          se puede compartir o guardar el cierre de un mes. */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-wrap gap-2">
            {rangos.map((p) => {
              const activo = p.desde === desde && p.hasta === hasta;
              return (
                <Link
                  key={p.etiqueta}
                  href={`/admin/finance?desde=${p.desde}&hasta=${p.hasta}`}
                  className={`rounded-lg px-3 py-2 text-sm font-medium ${
                    activo
                      ? 'bg-budi-primary-500 text-white'
                      : 'border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  {p.etiqueta}
                </Link>
              );
            })}
          </div>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-zinc-500">
              Desde
              <input type="date" name="desde" defaultValue={desde}
                className="mt-1 block rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
            </label>
            <label className="text-xs text-zinc-500">
              Hasta
              <input type="date" name="hasta" defaultValue={hasta}
                className="mt-1 block rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
            </label>
            <button type="submit"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Aplicar
            </button>
          </form>
        </div>
      </div>

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

      {/* Trabajo prestado que no facturó. Va arriba de las tablas y no escondido
          en una nota al pie: es plata que se dejó de cobrar. */}
      {Number(r.sin_precio) > 0 && (
        <Link
          href="/admin/requests?status=completed"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-amber-900 dark:text-amber-200">
            <strong>
              {r.sin_precio} {Number(r.sin_precio) === 1 ? 'servicio completado sin precio' : 'servicios completados sin precio'}
            </strong>{' '}
            en el periodo: se prestaron pero no facturaron, así que no suman al bruto ni al ticket
            promedio. Revísalos en Solicitudes.
          </span>
        </Link>
      )}

      {/* Por aseguradora */}
      {insurers && (
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">A facturar por aseguradora</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Lo que asumió cada póliza en el periodo. El copago lo paga el afiliado y no se le factura a la aseguradora.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800/60">
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                <th className="px-5 py-3 font-medium">Aseguradora</th>
                <th className="px-5 py-3 text-right font-medium">Servicios</th>
                <th className="px-5 py-3 text-right font-medium">A facturar</th>
                <th className="px-5 py-3 text-right font-medium">Copagos</th>
                <th className="px-5 py-3 text-right font-medium">Bruto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {porAseguradora.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-zinc-500">
                    Ningún servicio con cobertura en el periodo.
                  </td>
                </tr>
              ) : (
                porAseguradora.map((a) => (
                  <tr key={a.insurer_id} className="text-sm">
                    <td className="whitespace-nowrap px-5 py-3 font-medium text-zinc-900 dark:text-white">{a.aseguradora}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{a.servicios}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money(Number(a.a_facturar))}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{money(Number(a.copagos))}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{money(Number(a.bruto))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Liquidación (B-23, parcial: el cálculo; el registro de pagos depende del
          procesador que decida B-20). */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Liquidación a la red</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Se calcula sobre el bruto del servicio: el proveedor hizo el trabajo completo, sin
              importar quién lo pagó. Retenido por Budi {money(totalComision)} · a pagar{' '}
              <strong className="text-zinc-700 dark:text-zinc-300">{money(totalAPagar)}</strong>
              {totalEfectivo > 0 && <> · ya cobrado en efectivo por los socios {money(totalEfectivo)}</>}.
            </p>
          </div>
          <SettlementExportButton desde={desde} hasta={hasta} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800/60">
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                <th className="px-5 py-3 font-medium">Se le paga a</th>
                <th className="px-5 py-3 text-right font-medium">Comisión</th>
                <th className="px-5 py-3 text-right font-medium">Servicios</th>
                <th className="px-5 py-3 text-right font-medium">Bruto</th>
                <th className="px-5 py-3 text-right font-medium">Retiene Budi</th>
                <th className="px-5 py-3 text-right font-medium">A pagar</th>
                <th className="px-5 py-3 text-right font-medium" title="Lo que el Usuario ya le pagó en efectivo al socio (LAN-07)">Cobró en efectivo</th>
                <th className="px-5 py-3 text-right font-medium" title="A pagar menos el efectivo. Negativo: el socio le debe la comisión a Budi.">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {liquidacion.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-zinc-500">
                    Sin servicios completados en el periodo.
                  </td>
                </tr>
              ) : (
                liquidacion.map((l) => (
                  <tr key={l.provider_id ?? l.destinatario} className="text-sm">
                    <td className="whitespace-nowrap px-5 py-3 font-medium text-zinc-900 dark:text-white">
                      {l.destinatario}
                      {l.es_independiente && (
                        <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          independiente
                        </span>
                      )}
                      {Number(l.sin_precio) > 0 && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          {l.sin_precio} sin precio
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{l.comision_pct == null ? (
                      <span title="La tarifa cambió dentro del periodo: cada servicio se liquidó con la que regía cuando se completó.">Varias</span>
                    ) : `${Number(l.comision_pct)}%`}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{l.servicios}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{money(Number(l.bruto))}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">−{money(Number(l.comision))}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{money(Number(l.a_pagar))}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{Number(l.efectivo) > 0 ? `−${money(Number(l.efectivo))}` : '—'}</td>
                    <td className={`whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums ${Number(l.saldo) < 0 ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-900 dark:text-white'}`}
                        title={Number(l.saldo) < 0 ? 'Cobró en efectivo más de lo que Budi le debía: le debe la comisión a Budi.' : undefined}>
                      {Number(l.saldo) < 0 ? `Le debe ${money(-Number(l.saldo))}` : money(Number(l.saldo))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Facturado por socio operador</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Bruto de sus servicios completados. Lo que se le paga a su empresa está arriba, en Liquidación.
          </p>
        </div>
        <FinTable rows={operators} firstHeader="Socio operador" total={Number(r.bruto)} />
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Facturado por proveedor</h2>
        </div>
        <FinTable rows={providers} firstHeader="Proveedor" total={Number(r.bruto)} />
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
            <th className="px-5 py-3 text-right font-medium">Total</th>
            <th className="px-5 py-3 text-right font-medium">Ticket prom.</th>
            <th className="px-5 py-3 font-medium">% del total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-10 text-center text-sm text-zinc-500">
                Sin servicios completados en el periodo.
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
