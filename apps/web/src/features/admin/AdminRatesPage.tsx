'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronRight, Percent } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useConfirm, useToast } from '@/shared/components/FeedbackProvider';
import {
  RATE_KIND_LABELS,
  formatRate,
  formatValidFrom,
  hoySV,
  type RateKind,
} from './rates-format';

// Tarifas versionadas (migr. 00102). Cada cambio es una version nueva con
// fecha de inicio; ninguna version que ya rigio se edita, asi que los servicios
// completados conservan la tasa con la que se liquidaron.

type OverviewRow = {
  kind: RateKind;
  subject_id: string | null;
  subject_name: string;
  current_rate: number;
  own_rate: boolean;
  next_rate: number | null;
  next_is_default: boolean;
  next_from: string | null;
  versions: number;
};

type HistoryRow = {
  id: string;
  rate: number | null;
  valid_from: string;
  valid_until: string | null;
  status: 'programada' | 'vigente' | 'anterior';
  note: string | null;
  created_by_name: string | null;
  created_at: string;
};

const SECTIONS: { kind: RateKind; title: string; hint: string }[] = [
  {
    kind: 'platform_default',
    title: 'Default de plataforma',
    hint: 'La comisión de toda empresa o socio operador independiente sin una tarifa propia negociada.',
  },
  {
    kind: 'provider',
    title: 'Empresas',
    hint: 'Porcentaje del bruto que retiene Budi. Sin tarifa propia, siguen el default.',
  },
  {
    kind: 'operator',
    title: 'Socios operadores independientes',
    hint: 'Solo aplica a los servicios que hicieron sin empresa.',
  },
  {
    kind: 'mopt_fee',
    title: 'Programas MOPT',
    hint: 'Lo que Budi le cobra al programa por servicio. Sin tarifa fijada es 0%, no el default.',
  },
];

const STATUS_STYLES: Record<HistoryRow['status'], string> = {
  programada: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  vigente: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  anterior: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

const rowKey = (r: { kind: string; subject_id: string | null }) => `${r.kind}:${r.subject_id ?? ''}`;

export default function AdminRatesPage() {
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editing, setEditing] = useState<OverviewRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    const load = async () => {
      const { data, error } = await createClient().rpc('admin_rate_overview');
      if (error) console.error('Error cargando tarifas:', error);
      setLoadError(error?.message ?? null);
      setRows((data ?? []) as unknown as OverviewRow[]);
      setLoading(false);
    };
    load();
  }, [refreshKey]);

  const loadHistory = useCallback(async (row: OverviewRow) => {
    setHistoryLoading(true);
    const { data, error } = await createClient().rpc('admin_rate_history', {
      p_kind: row.kind,
      // El default de plataforma no tiene sujeto: la RPC compara con IS NOT DISTINCT FROM.
      ...(row.subject_id ? { p_subject: row.subject_id } : {}),
    } as { p_kind: string; p_subject: string });
    if (error) toast.error(`No se pudo cargar la historia: ${error.message}`);
    setHistory((data ?? []) as unknown as HistoryRow[]);
    setHistoryLoading(false);
  }, [toast]);

  const refresh = () => {
    setRefreshKey((k) => k + 1);
    const open = rows.find((r) => rowKey(r) === expanded);
    if (open) loadHistory(open);
  };

  const toggle = (row: OverviewRow) => {
    const key = rowKey(row);
    if (expanded === key) {
      setExpanded(null);
      return;
    }
    setExpanded(key);
    setHistory([]);
    loadHistory(row);
  };

  const cancelVersion = async (row: OverviewRow, v: HistoryRow) => {
    const ok = await confirm({
      title: '¿Cancelar el cambio programado?',
      message: `${row.subject_name}: ${formatRate(v.rate, row.kind)} desde el ${formatValidFrom(v.valid_from)}. Todavía no rige, así que ningún servicio se calculó con él.`,
      confirmLabel: 'Cancelar cambio',
      cancelLabel: 'Volver',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await createClient().rpc('admin_cancel_rate_version', { p_id: v.id });
    if (error) return toast.error(error.message);
    toast.success('Cambio cancelado.');
    refresh();
  };

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => !q || r.subject_name.toLowerCase().includes(q));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Tarifas</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Comisiones de Budi y tarifas de los programas MOPT, con su historia
        </p>
      </div>

      <div className="mb-6 flex gap-3 rounded-xl border border-budi-primary-200 bg-budi-primary-50 p-4 text-sm text-budi-primary-900 dark:border-budi-primary-900 dark:bg-budi-primary-950/40 dark:text-budi-primary-200">
        <CalendarClock className="mt-0.5 h-5 w-5 shrink-0" />
        <p>
          Un cambio de tarifa rige desde el día que elijas y <strong>nunca toca los servicios ya completados</strong>:
          cada uno se liquida con la tasa que regía cuando se completó. No se puede fijar una fecha pasada, y un cambio
          programado se puede cancelar mientras no haya empezado.
        </p>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar empresa, programa o socio operador…"
        className="mb-6 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:max-w-sm"
      />

      {loadError && (
        <p className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          No se pudieron cargar las tarifas: {loadError}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Cargando…</p>
      ) : (
        <div className="space-y-8">
          {SECTIONS.map((section) => {
            const items = visible.filter((r) => r.kind === section.kind);
            if (items.length === 0 && (q || section.kind !== 'platform_default')) return null;
            return (
              <section key={section.kind}>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-white">{section.title}</h2>
                <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">{section.hint}</p>
                <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                      <tr>
                        <th className="px-5 py-3 font-medium">{section.kind === 'platform_default' ? 'Tarifa' : 'Nombre'}</th>
                        <th className="px-5 py-3 text-right font-medium">Rige hoy</th>
                        <th className="px-5 py-3 font-medium">Próximo cambio</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {items.map((row) => {
                        const key = rowKey(row);
                        const open = expanded === key;
                        return (
                          <Fragment key={key}>
                            <tr>
                              <td className="px-5 py-3">
                                <button
                                  onClick={() => toggle(row)}
                                  className="flex items-center gap-1.5 text-left font-medium text-zinc-900 hover:text-budi-primary-600 dark:text-white dark:hover:text-budi-primary-400"
                                  aria-expanded={open}
                                >
                                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  {row.subject_name}
                                </button>
                              </td>
                              <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">
                                <span className="font-semibold text-zinc-900 dark:text-white">{Number(row.current_rate)}%</span>
                                {!row.own_rate && (
                                  <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                    default
                                  </span>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-5 py-3 text-zinc-600 dark:text-zinc-400">
                                {row.next_from ? (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                    {row.next_is_default ? 'Vuelve al default' : `${Number(row.next_rate)}%`} desde el {formatValidFrom(row.next_from)}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="whitespace-nowrap px-5 py-3 text-right">
                                <button
                                  onClick={() => setEditing(row)}
                                  className="rounded-lg bg-budi-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-budi-primary-600"
                                >
                                  Programar cambio
                                </button>
                              </td>
                            </tr>
                            {open && (
                              <tr>
                                <td colSpan={4} className="bg-zinc-50 px-5 py-4 dark:bg-zinc-950/40">
                                  <HistoryTable
                                    row={row}
                                    history={history}
                                    loading={historyLoading}
                                    onCancel={(v) => cancelVersion(row, v)}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {editing && (
        <ScheduleModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function HistoryTable({
  row,
  history,
  loading,
  onCancel,
}: {
  row: OverviewRow;
  history: HistoryRow[];
  loading: boolean;
  onCancel: (v: HistoryRow) => void;
}) {
  if (loading) return <p className="text-sm text-zinc-500">Cargando historia…</p>;
  if (history.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        {row.kind === 'mopt_fee'
          ? 'Nunca se fijó una tarifa: se cobra 0%.'
          : 'Nunca tuvo tarifa propia: siempre siguió el default de plataforma.'}
      </p>
    );
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-zinc-500">
        <tr>
          <th className="py-2 pr-4 font-medium">Tasa</th>
          <th className="py-2 pr-4 font-medium">Vigencia</th>
          <th className="py-2 pr-4 font-medium">Estado</th>
          <th className="py-2 pr-4 font-medium">Nota</th>
          <th className="py-2 pr-4 font-medium">Registró</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {history.map((v) => (
          <tr key={v.id}>
            <td className="whitespace-nowrap py-2 pr-4 font-medium tabular-nums text-zinc-900 dark:text-white">
              {formatRate(v.rate, row.kind)}
            </td>
            <td className="whitespace-nowrap py-2 pr-4 text-zinc-600 dark:text-zinc-400">
              {v.valid_from === '-infinity' ? 'Desde siempre' : `Desde el ${formatValidFrom(v.valid_from)}`}
              {v.valid_until && ` hasta el ${formatValidFrom(v.valid_until)}`}
            </td>
            <td className="py-2 pr-4">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[v.status]}`}>
                {v.status}
              </span>
            </td>
            <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{v.note ?? '—'}</td>
            <td className="whitespace-nowrap py-2 pr-4 text-zinc-600 dark:text-zinc-400">{v.created_by_name ?? 'Sistema'}</td>
            <td className="py-2 text-right">
              {v.status === 'programada' && (
                <button
                  onClick={() => onCancel(v)}
                  className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  Cancelar
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScheduleModal({
  row,
  onClose,
  onSaved,
}: {
  row: OverviewRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = hoySV();
  const canInherit = row.kind === 'provider' || row.kind === 'operator';
  const [rate, setRate] = useState(String(Number(row.current_rate)));
  const [inherit, setInherit] = useState(false);
  const [effective, setEffective] = useState(today);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = Number(rate);
    if (!inherit && (rate.trim() === '' || Number.isNaN(value) || value < 0 || value > 100)) {
      setError('La tasa debe estar entre 0 y 100.');
      return;
    }
    setSaving(true);
    const { data, error: rpcError } = await createClient().rpc('admin_schedule_rate', {
      p_kind: row.kind,
      ...(row.subject_id ? { p_subject: row.subject_id } : {}),
      ...(inherit ? {} : { p_rate: value }),
      ...(effective && effective !== today ? { p_effective: effective } : {}),
      ...(note.trim() ? { p_note: note.trim() } : {}),
    } as { p_kind: string; p_subject: string; p_rate: number });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (data == null) {
      toast.info('No hay nada que cambiar: esa ya es la tarifa.');
      onClose();
      return;
    }
    toast.success(effective === today ? 'Tarifa cambiada desde ahora.' : `Cambio programado para el ${formatValidFrom(`${effective}T12:00:00Z`)}.`);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900"
      >
        <div className="mb-4 flex items-center gap-2">
          <Percent className="h-5 w-5 text-budi-primary-600 dark:text-budi-primary-400" />
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Programar cambio</h2>
        </div>
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          {RATE_KIND_LABELS[row.kind]} · <strong>{row.subject_name}</strong> · hoy rige {Number(row.current_rate)}%
          {!row.own_rate && ' (default)'}
        </p>

        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Nueva tasa (%)</label>
        <input
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={rate}
          disabled={inherit}
          onChange={(e) => setRate(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
        {canInherit && (
          <label className="mt-2 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={inherit} onChange={(e) => setInherit(e.target.checked)} />
            Sin tarifa propia: seguir el default de plataforma
          </label>
        )}

        <label className="mt-4 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Rige desde</label>
        <input
          type="date"
          min={today}
          value={effective}
          onChange={(e) => setEffective(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
        <p className="mt-1 text-xs text-zinc-500">
          {effective === today
            ? 'Hoy: aplica a los servicios que se completen desde este momento.'
            : 'Desde las 00:00 de ese día, hora de El Salvador.'}
        </p>

        <label className="mt-4 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Nota (opcional)</label>
        <input
          type="text"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ej.: renegociado en contrato 2026"
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />

        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
