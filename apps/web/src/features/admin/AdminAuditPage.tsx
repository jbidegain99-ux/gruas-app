'use client';

import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { Pagination } from '@/shared/components/Pagination';
import {
  AUDIT_ACTION_LABELS,
  auditColumnLabel,
  auditRoleLabel,
  auditTableLabel,
  formatAuditValue,
  type AuditChanges,
} from './audit-format';

const PAGE_SIZE = 50;

type Entry = {
  id: number;
  occurred_at: string;
  actor_id: string;
  actor_role: string | null;
  actor_name: string | null;
  actor_email: string | null;
  table_name: string;
  action: string;
  record_id: string | null;
  record_label: string | null;
  changes: AuditChanges;
  total_count: number;
};

type Facet = { value: string; label?: string; count: number };
type Facets = { tables: Facet[]; actions: Facet[]; actors: Facet[] };

const ACTION_COLORS: Record<string, string> = {
  INSERT: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  UPDATE: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

const selectClass =
  'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200';

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets>({ tables: [], actions: [], actors: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  const [table, setTable] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Las opciones de los filtros salen de los datos (GROUP BY en la base), no
  // de una lista fija: una tabla nueva auditada aparece sola.
  useEffect(() => {
    createClient()
      .rpc('admin_audit_log_facets')
      .then(({ data }) => {
        if (data) setFacets(data as unknown as Facets);
      });
  }, []);

  useEffect(() => {
    const fetchPage = async () => {
      setLoading(true);
      // Paginación en la base: la bitácora crece sin techo y no se trae entera.
      const { data, error } = await createClient().rpc('admin_audit_log', {
        ...(table ? { p_table: table } : {}),
        ...(action ? { p_action: action } : {}),
        ...(actor ? { p_actor: actor } : {}),
        // Días en hora de El Salvador: la base los resuelve con sv_day_start.
        ...(from ? { p_from: from } : {}),
        ...(to ? { p_to: to } : {}),
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (error) console.error('Error cargando la bitácora:', error);
      setLoadError(error?.message ?? null);
      const rows = (data ?? []) as unknown as Entry[];
      setEntries(rows);
      setTotal(rows[0]?.total_count ?? 0);
      setLoading(false);
    };
    fetchPage();
  }, [table, action, actor, from, to, page]);

  // Cualquier cambio de filtro vuelve a la primera página.
  const onFilter = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(0);
  };

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Bitácora</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Quién cambió qué en la configuración, las tarifas, las empresas y los roles
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800 lg:flex-row lg:flex-wrap lg:items-center">
          <select value={table} onChange={(e) => onFilter(setTable)(e.target.value)} className={selectClass} aria-label="Sección">
            <option value="">Todas las secciones</option>
            {facets.tables.map((f) => (
              <option key={f.value} value={f.value}>
                {auditTableLabel(f.value)} ({f.count})
              </option>
            ))}
          </select>
          <select value={action} onChange={(e) => onFilter(setAction)(e.target.value)} className={selectClass} aria-label="Acción">
            <option value="">Todas las acciones</option>
            {facets.actions.map((f) => (
              <option key={f.value} value={f.value}>
                {AUDIT_ACTION_LABELS[f.value] ?? f.value} ({f.count})
              </option>
            ))}
          </select>
          <select value={actor} onChange={(e) => onFilter(setActor)(e.target.value)} className={selectClass} aria-label="Quién">
            <option value="">Todas las personas</option>
            {facets.actors.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label} ({f.count})
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            Desde
            <input type="date" value={from} max={to || undefined} onChange={(e) => onFilter(setFrom)(e.target.value)} className={selectClass} />
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            Hasta
            <input type="date" value={to} min={from || undefined} onChange={(e) => onFilter(setTo)(e.target.value)} className={selectClass} />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="w-8 px-4 py-3" />
                {['Fecha', 'Quién', 'Acción', 'Sección', 'Registro', 'Campos'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-zinc-500">Cargando...</td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-red-600 dark:text-red-400">
                    No se pudo cargar la bitácora: {loadError}
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-zinc-500">
                    <History className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
                    No hay cambios registrados con esos filtros
                  </td>
                </tr>
              ) : (
                entries.map((e) => {
                  const open = expanded.has(e.id);
                  const fields = Object.keys(e.changes);
                  return (
                    <Fragment key={e.id}>
                      <tr
                        onClick={() => toggle(e.id)}
                        className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        aria-expanded={open}
                      >
                        <td className="px-4 py-3 text-zinc-400">
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                          {new Date(e.occurred_at).toLocaleString('es-SV', {
                            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <p className="font-medium text-zinc-900 dark:text-white">{e.actor_name || e.actor_email || 'Sin nombre'}</p>
                          {/* El rol que tenía AL hacer el cambio, no el de hoy. */}
                          {e.actor_role && <p className="text-xs text-zinc-500">{auditRoleLabel(e.actor_role)}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${ACTION_COLORS[e.action] ?? ''}`}>
                            {AUDIT_ACTION_LABELS[e.action] ?? e.action}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                          {auditTableLabel(e.table_name)}
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                          {e.record_label || <span className="font-mono text-xs text-zinc-500">{e.record_id?.slice(0, 8) ?? '—'}</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-500">
                          {fields.slice(0, 3).map(auditColumnLabel).join(', ')}
                          {fields.length > 3 && ` y ${fields.length - 3} más`}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-zinc-50/60 dark:bg-zinc-800/30">
                          <td />
                          <td colSpan={6} className="px-4 pb-4 pt-1">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
                                  <th className="py-1 pr-4 font-medium">Campo</th>
                                  <th className="py-1 pr-4 font-medium">Antes</th>
                                  <th className="py-1 font-medium">Después</th>
                                </tr>
                              </thead>
                              <tbody>
                                {fields.map((k) => (
                                  <tr key={k} className="align-top">
                                    <td className="py-1 pr-4 text-zinc-700 dark:text-zinc-300">{auditColumnLabel(k)}</td>
                                    <td className="break-all py-1 pr-4 text-red-700 dark:text-red-400">{formatAuditValue(e.changes[k].old, k)}</td>
                                    <td className="break-all py-1 text-green-700 dark:text-green-400">{formatAuditValue(e.changes[k].new, k)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {e.record_id && (
                              <p className="mt-2 font-mono text-xs text-zinc-400">id {e.record_id}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </div>
    </div>
  );
}
