'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Smartphone, Upload } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { MemberImportModal } from '@/features/admin/MemberImportModal';
import { formatDate } from '@/shared/lib/format';

// Padrón de una póliza (migr. 00127, ASE-02): buscar, importar por CSV (en
// lotes) y dar de baja o reactivar con motivo.

type Member = {
  id: string; document_number: string; full_name: string; phone: string | null; relationship: 'holder' | 'beneficiary';
  starts_on: string; ends_on: string | null; is_active: boolean; has_app: boolean;
  deactivated_at: string | null; deactivation_reason: string | null;
};
const PAGE = 50;

export default function InsurerPolicyMembersPage({ policyId }: { policyId: string }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; rows: Member[] } | null>(null);
  // Una falla (póliza ajena o inexistente) dejaba "Cargando…" para siempre.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [bajaFor, setBajaFor] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    createClient().rpc('portal_insurer_catalog').then(({ data: c }) => setRole((c as { role?: string } | null)?.role ?? null));
  }, []);

  useEffect(() => {
    const id = setTimeout(async () => {
      const { data: d, error } = await createClient().rpc('portal_policy_members', {
        p_policy: policyId, p_search: q, p_limit: PAGE, p_offset: page * PAGE,
      });
      if (error) {
        toast.error(error.message);
        setLoadError(error.message);
      } else {
        setLoadError(null);
        setData(d as unknown as { total: number; rows: Member[] });
      }
    }, 250);
    return () => clearTimeout(id);
  }, [policyId, q, page, refresh, toast]);

  const canEdit = role === 'owner' || role === 'admin' || role === 'analyst';

  const setActive = async (m: Member, active: boolean) => {
    const { error } = await createClient().rpc('portal_set_member_active', { p_member: m.id, p_active: active, p_reason: motivo });
    if (error) return toast.error(error.message);
    toast.success(active ? 'Afiliado reactivado.' : 'Afiliado dado de baja: ya no tiene cobertura.');
    setBajaFor(null);
    setMotivo('');
    setRefresh((k) => k + 1);
  };

  return (
    <div className="space-y-5">
      <Link href="/portal/polizas" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
        <ArrowLeft className="h-4 w-4" /> Pólizas
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Afiliados</h1>
          <p className="text-sm text-zinc-500">{data ? `${data.total.toLocaleString('es-SV')} en esta póliza` : ''}</p>
        </div>
        {canEdit && (
          <button onClick={() => setImporting(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700">
            <Upload className="h-4 w-4" /> Importar CSV
          </button>
        )}
      </div>

      <label className="relative block max-w-md">
        <span className="sr-only">Buscar afiliado</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          placeholder="Nombre o documento"
          className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        />
      </label>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Afiliado</th><th className="px-4 py-3">Documento</th><th className="px-4 py-3">Relación</th>
              <th className="px-4 py-3">Vigencia</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {loadError && !data ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-red-600">No se pudo cargar el padrón: {loadError}</td></tr>
            ) : !data ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Cargando…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">{q ? 'Nadie coincide con la búsqueda.' : 'Sin afiliados todavía. Importa el padrón por CSV.'}</td></tr>
            ) : data.rows.map((m) => (
              <tr key={m.id} className={m.is_active ? '' : 'opacity-60'}>
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-900 dark:text-white">{m.full_name}</p>
                  {m.has_app && <p className="inline-flex items-center gap-1 text-xs text-zinc-500"><Smartphone className="h-3 w-3" /> Usa la app</p>}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{m.document_number}</td>
                <td className="px-4 py-3">{m.relationship === 'holder' ? 'Titular' : 'Beneficiario'}</td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{formatDate(m.starts_on)}{m.ends_on ? ` – ${formatDate(m.ends_on)}` : ''}</td>
                <td className="px-4 py-3">
                  {m.is_active ? 'Activo' : <span title={m.deactivation_reason ?? ''}>De baja{m.deactivated_at ? ` desde ${formatDate(m.deactivated_at)}` : ''}</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {canEdit && (m.is_active ? (
                    bajaFor === m.id ? (
                      <span className="inline-flex gap-1">
                        <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" className="w-36 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800" />
                        <button onClick={() => setActive(m, false)} disabled={!motivo.trim()} className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">Dar de baja</button>
                        <button onClick={() => setBajaFor(null)} className="px-1 text-xs text-zinc-500">✕</button>
                      </span>
                    ) : (
                      <button onClick={() => { setBajaFor(m.id); setMotivo(''); }} className="text-xs text-red-600 hover:underline">Dar de baja</button>
                    )
                  ) : (
                    <button onClick={() => setActive(m, true)} className="text-xs text-budi-primary-600 hover:underline dark:text-budi-primary-400">Reactivar</button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.total > PAGE && (
        <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
          <span>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, data.total)} de {data.total.toLocaleString('es-SV')}</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-700">Anterior</button>
            <button disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage((p) => p + 1)} className="rounded border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-700">Siguiente</button>
          </div>
        </div>
      )}

      {importing && (
        <MemberImportModal
          policyId={policyId}
          source="portal"
          onClose={() => setImporting(false)}
          onImported={() => setRefresh((k) => k + 1)}
        />
      )}
    </div>
  );
}
