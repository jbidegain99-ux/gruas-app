'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { ServiceTypeBadge, serviceTypeLabel } from '@/shared/components/ServiceTypeBadge';
import { StatusBadge, STATUS_LABELS } from '@/shared/components/StatusBadge';
import { CaseFilters } from '@/shared/components/portal/CaseFilters';
import { defaultCaseFilters, exportBasename, filterCases, zoneOptions } from '@/shared/components/portal/case-filters';
import { liveLabel, useOrgLive } from '@/shared/components/portal/useOrgLive';
import { exportTable, type ExportColumn } from '@/shared/lib/export/table-export';
import { svToday } from '@/shared/components/LedgerPaymentModals';
import { money } from '@/shared/lib/format';

type Row = {
  id: string;
  folio: string | null;
  status: string;
  service_type: string;
  client_name: string | null;
  vehicle_plate: string | null;
  pickup_address: string | null;
  operator_name: string | null;
  created_at: string;
  completed_at: string | null;
  total_price: number | null;
  zone: string | null;
};

const EXPORT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Folio', value: (r) => r.folio },
  { header: 'Pedido', value: (r) => new Date(r.created_at).toLocaleString('es-SV', { timeZone: 'America/El_Salvador' }) },
  { header: 'Servicio', value: (r) => serviceTypeLabel(r.service_type) },
  { header: 'Estado', value: (r) => STATUS_LABELS[r.status] ?? r.status },
  { header: 'Atendido', value: (r) => r.client_name },
  { header: 'Placa', value: (r) => r.vehicle_plate },
  { header: 'Zona', value: (r) => r.zone },
  { header: 'Lugar', value: (r) => r.pickup_address },
  { header: 'Socio operador', value: (r) => r.operator_name },
  { header: 'Monto (USD)', value: (r) => (r.total_price == null ? null : Number(r.total_price)) },
];

export default function MoptServicesPage() {
  const router = useRouter();
  const [filters, setFilters] = useState(() => defaultCaseFilters(svToday()));
  const { tick, live } = useOrgLive();
  const [allRows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error: e } = await createClient().rpc('mopt_list_services', { p_from: filters.from, p_to: filters.to });
      if (!alive) return;
      setError(e?.message ?? null);
      setRows((data as Row[]) ?? []);
      setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, [filters.from, filters.to, tick]);

  const rows = useMemo(() => filterCases(allRows, filters), [allRows, filters]);
  const total = rows.reduce((a, r) => a + Number(r.total_price ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Servicios</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Los servicios que cubre tu programa. Toca uno para ver el detalle, el recorrido y la línea de tiempo.{' '}
            <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
              <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-zinc-400'}`} aria-hidden="true" />
              {liveLabel(live)}
            </span>
          </p>
        </div>
      </div>

      <CaseFilters
        value={filters}
        onChange={setFilters}
        zones={zoneOptions(allRows)}
        exportDisabled={rows.length === 0}
        onExport={(f) => exportTable(rows, EXPORT_COLUMNS, f, exportBasename('servicios_mopt', filters))}
      />

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">Folio</th>
              <th className="px-4 py-3 font-medium">Servicio</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Atendido</th>
              <th className="px-4 py-3 font-medium">Lugar</th>
              <th className="px-4 py-3 font-medium">Socio operador</th>
              <th className="px-4 py-3 font-medium">Pedido</th>
              <th className="px-4 py-3 text-right font-medium">Monto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">Cargando...</td></tr>
            ) : error ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-red-600 dark:text-red-400">No se pudieron cargar los servicios: {error}</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-zinc-500">
                  <Inbox className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
                  {allRows.length === 0 ? 'No hay servicios en ese periodo' : 'Ningún servicio coincide con los filtros'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/mopt/servicios/${r.id}`)}
                  className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">{r.folio ?? '—'}</td>
                  <td className="px-4 py-3"><ServiceTypeBadge serviceType={r.service_type} /></td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">
                    <p className="text-zinc-900 dark:text-white">{r.client_name ?? '—'}</p>
                    {r.vehicle_plate && <p className="font-mono text-xs text-zinc-500">{r.vehicle_plate}</p>}
                  </td>
                  <td className="max-w-[16rem] px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {r.pickup_address ?? '—'}
                    {r.zone && <p className="text-xs text-zinc-500">{r.zone}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-700 dark:text-zinc-300">{r.operator_name ?? 'Sin asignar'}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-600 dark:text-zinc-400">
                    {new Date(r.created_at).toLocaleString('es-SV', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador' })}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-zinc-900 dark:text-white">
                    {r.total_price == null ? '—' : money(Number(r.total_price))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && !loading && (
            <tfoot className="border-t border-zinc-200 dark:border-zinc-800">
              <tr>
                <td colSpan={7} className="px-4 py-3 text-right text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  {rows.length} servicios
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">{money(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
