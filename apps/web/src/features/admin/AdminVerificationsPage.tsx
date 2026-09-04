'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, ShieldCheck, Inbox } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { Pagination } from '@/shared/components/Pagination';
import { formatDate } from '@/shared/lib/format';

type OperatorRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  provider_name: string | null;
  verification_status: string;
  verification_submitted_at: string | null;
  verification_rejection_reason: string | null;
};

type SignedDoc = { doc_type: string; url: string | null };

const PAGE_SIZE = 15;

const DOC_LABELS: Record<string, string> = {
  dui_front: 'DUI (frente)',
  dui_back: 'DUI (reverso)',
  license: 'Licencia de conducir',
  circulation: 'Tarjeta de circulación',
  tow_photo: 'Foto de la grúa',
  insurance: 'Póliza de seguro',
};
const DOC_ORDER = ['dui_front', 'dui_back', 'license', 'circulation', 'tow_photo', 'insurance'];

const VERIF_BADGE: Record<string, string> = {
  approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};
const VERIF_LABEL: Record<string, string> = {
  approved: 'Aprobado',
  pending: 'En revisión',
  rejected: 'Rechazado',
};

type FilterKey = 'review' | 'approved' | 'rejected' | 'all';

export default function AdminVerificationsPage() {
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('review');
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<OperatorRow | null>(null);
  const [docs, setDocs] = useState<SignedDoc[] | null>(null);
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const fetchOperators = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, full_name, phone, verification_status, verification_submitted_at, verification_rejection_reason, providers:provider_id (name)'
        )
        .eq('role', 'OPERATOR')
        .order('verification_submitted_at', { ascending: false, nullsFirst: false });

      if (error) {
        console.error('Error fetching operators:', error);
        toast.error('No se pudieron cargar los operadores.');
        setLoading(false);
        return;
      }

      setOperators(
        (data || []).map((p) => ({
          id: p.id,
          full_name: p.full_name,
          phone: p.phone,
          provider_name: (p.providers as unknown as { name: string } | null)?.name || null,
          // La columna pasó a ser nullable en la 00076 (solo los operadores
          // llevan estado). Esta consulta ya filtra por rol OPERATOR, así que un
          // NULL aquí solo puede ser un operador dado de alta por una vía que no
          // pasó por el trigger: sin revisar, o sea pendiente.
          verification_status: p.verification_status ?? 'pending',
          verification_submitted_at: p.verification_submitted_at,
          verification_rejection_reason: p.verification_rejection_reason,
        }))
      );
      setLoading(false);
    };
    fetchOperators();
  }, [refreshKey, toast]);

  const refetch = () => setRefreshKey((k) => k + 1);

  // "En revisión" = envió documentos y sigue pendiente.
  const inReview = (o: OperatorRow) =>
    o.verification_status === 'pending' && !!o.verification_submitted_at;

  const filtered = useMemo(() => {
    switch (filter) {
      case 'review':
        return operators.filter(inReview);
      case 'approved':
        return operators.filter((o) => o.verification_status === 'approved');
      case 'rejected':
        return operators.filter((o) => o.verification_status === 'rejected');
      default:
        return operators;
    }
  }, [operators, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const reviewCount = operators.filter(inReview).length;

  // Cargar los documentos (URLs firmadas, bucket privado) al abrir un operador.
  const openOperator = useCallback(async (op: OperatorRow) => {
    setSelected(op);
    setReason('');
    setDocs(null);
    const supabase = createClient();
    const { data: rows, error } = await supabase
      .from('operator_documents')
      .select('doc_type, bucket, path')
      .eq('operator_id', op.id);

    if (error) {
      setDocs([]);
      return;
    }

    const sorted = (rows || []).slice().sort(
      (a, b) => DOC_ORDER.indexOf(a.doc_type) - DOC_ORDER.indexOf(b.doc_type)
    );
    const signed = await Promise.all(
      sorted.map(async (d) => {
        const { data } = await supabase.storage.from(d.bucket).createSignedUrl(d.path, 300);
        return { doc_type: d.doc_type, url: data?.signedUrl ?? null };
      })
    );
    setDocs(signed);
  }, []);

  const close = () => {
    setSelected(null);
    setDocs(null);
    setReason('');
  };

  const review = async (status: 'approved' | 'rejected') => {
    if (!selected) return;
    if (status === 'rejected' && !reason.trim()) {
      toast.error('Escribe el motivo del rechazo.');
      return;
    }
    setActing(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('admin_set_operator_verification', {
      p_operator_id: selected.id,
      p_status: status,
      p_reason: status === 'rejected' ? reason.trim() : undefined,
    });
    setActing(false);
    if (error) {
      toast.error('No se pudo actualizar la verificación.');
      return;
    }
    toast.success(status === 'approved' ? 'Operador aprobado.' : 'Operador rechazado.');
    close();
    refetch();
  };

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: 'review', label: `En revisión${reviewCount ? ` (${reviewCount})` : ''}` },
    { key: 'approved', label: 'Aprobados' },
    { key: 'rejected', label: 'Rechazados' },
    { key: 'all', label: 'Todos' },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">
          Verificaciones
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Revisa los documentos de los operadores y aprueba o rechaza su cuenta
        </p>
      </div>

      {/* Filtros */}
      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setFilter(f.key);
              setPage(0);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              filter === f.key
                ? 'bg-budi-primary-500 text-white'
                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                {['Operador', 'Teléfono', 'Proveedor', 'Enviado', 'Estado'].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-zinc-500">
                    Cargando...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <Inbox className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                    <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      {filter === 'review'
                        ? 'No hay operadores esperando revisión'
                        : 'No hay operadores en este filtro'}
                    </p>
                  </td>
                </tr>
              ) : (
                paged.map((op) => (
                  <tr
                    key={op.id}
                    onClick={() => openOperator(op)}
                    className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-zinc-900 dark:text-white">
                      {op.full_name || 'Sin nombre'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {op.phone || '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {op.provider_name || '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-500 dark:text-zinc-500">
                      {formatDate(op.verification_submitted_at)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          VERIF_BADGE[op.verification_status] || VERIF_BADGE.pending
                        }`}
                      >
                        {VERIF_LABEL[op.verification_status] || op.verification_status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
      </div>

      {/* Drawer de revisión */}
      {selected && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={close}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col overflow-y-auto border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">
                  {selected.full_name || 'Operador'}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {selected.phone || 'Sin teléfono'}
                  {selected.provider_name ? ` · ${selected.provider_name}` : ''}
                </p>
              </div>
              <button
                onClick={close}
                aria-label="Cerrar"
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-4 p-6">
              <div>
                <span
                  className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                    VERIF_BADGE[selected.verification_status] || VERIF_BADGE.pending
                  }`}
                >
                  {VERIF_LABEL[selected.verification_status] || selected.verification_status}
                </span>
                {selected.verification_status === 'rejected' && selected.verification_rejection_reason && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                    Motivo anterior: {selected.verification_rejection_reason}
                  </p>
                )}
              </div>

              {/* Documentos */}
              {docs === null ? (
                <p className="text-sm text-zinc-500">Cargando documentos...</p>
              ) : docs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
                  Este operador aún no ha subido documentos.
                </div>
              ) : (
                <div className="space-y-4">
                  {docs.map((d) => (
                    <div key={d.doc_type}>
                      <p className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {DOC_LABELS[d.doc_type] || d.doc_type}
                      </p>
                      {d.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={d.url}
                          alt={DOC_LABELS[d.doc_type] || d.doc_type}
                          className="w-full rounded-lg border border-zinc-200 object-contain dark:border-zinc-700"
                        />
                      ) : (
                        <p className="text-sm text-red-500">No se pudo cargar la imagen.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Acciones */}
            <div className="sticky bottom-0 space-y-3 border-t border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motivo del rechazo (requerido para rechazar)..."
                rows={2}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => review('rejected')}
                  disabled={acting}
                  className="flex-1 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950"
                >
                  Rechazar
                </button>
                <button
                  onClick={() => review('approved')}
                  disabled={acting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Aprobar
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
