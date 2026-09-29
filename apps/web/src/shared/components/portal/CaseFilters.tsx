'use client';

import { Download, Search } from 'lucide-react';
import { STATUS_LABELS } from '@/shared/components/StatusBadge';
import { SERVICE_TYPE_KEYS, serviceTypeLabel } from '@/shared/components/ServiceTypeBadge';
import type { CaseFilterState } from './case-filters';

const input =
  'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200';

/**
 * Barra de filtros común a los portales (aseguradora y MOPT, POR-03): fechas,
 * estado, servicio, zona, búsqueda por folio y exportación de lo filtrado.
 */
export function CaseFilters({
  value,
  onChange,
  zones,
  onExport,
  exportDisabled,
}: {
  value: CaseFilterState;
  onChange: (next: CaseFilterState) => void;
  zones: string[];
  onExport: (format: 'csv' | 'xlsx') => void;
  exportDisabled?: boolean;
}) {
  const set = (patch: Partial<CaseFilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <label className="relative min-w-[10rem] flex-1">
        <span className="sr-only">Buscar por folio</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          value={value.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Folio (ej. 12 o BUDI-000012)"
          className={`${input} w-full pl-9`}
        />
      </label>
      <label className="flex flex-col text-xs text-zinc-500">
        Desde
        <input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && set({ from: e.target.value })} className={input} />
      </label>
      <label className="flex flex-col text-xs text-zinc-500">
        Hasta
        <input type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && set({ to: e.target.value })} className={input} />
      </label>
      <label className="flex flex-col text-xs text-zinc-500">
        Estado
        <select value={value.status} onChange={(e) => set({ status: e.target.value })} className={input}>
          <option value="">Todos</option>
          {Object.entries(STATUS_LABELS).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-zinc-500">
        Servicio
        <select value={value.service} onChange={(e) => set({ service: e.target.value })} className={input}>
          <option value="">Todos</option>
          {SERVICE_TYPE_KEYS.map((k) => (
            <option key={k} value={k}>{serviceTypeLabel(k)}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-zinc-500">
        Zona
        <select value={value.zone} onChange={(e) => set({ zone: e.target.value })} className={input}>
          <option value="">Todas</option>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        {(['csv', 'xlsx'] as const).map((f) => (
          <button
            key={f}
            onClick={() => onExport(f)}
            disabled={exportDisabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Download className="h-4 w-4" /> {f === 'csv' ? 'CSV' : 'Excel'}
          </button>
        ))}
      </div>
    </div>
  );
}
