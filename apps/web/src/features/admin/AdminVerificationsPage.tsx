'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, ShieldCheck, Inbox, CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useConfirm, useToast } from '@/shared/components/FeedbackProvider';
import { PartnerTermsEvidence } from './PartnerTermsEvidence';
import { PartnerTrainingStatus } from './PartnerTrainingStatus';
import { Pagination } from '@/shared/components/Pagination';
import { formatDate } from '@/shared/lib/format';
import { DOC_LABEL, DOCS, type DocType, type ReviewStatus } from '@/features/partners/partner-application';
import { PARTNER_SERVICES, PARTNER_VEHICLE_TYPES } from '@/features/partners/partner-options';

// Verificación de socios operadores (backlog AGT-03, migr. 00114): revisión
// documento por documento con nota, vencimientos editables, y la decisión
// global. La base exige cada documento aprobado y vigente para aprobar, arma
// el motivo del rechazo con las notas, y suspende sola al vencer un documento.

type OperatorRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  provider_name: string | null;
  verification_status: string;
  verification_submitted_at: string | null;
  verification_rejection_reason: string | null;
};

type AppDoc = {
  doc_type: DocType;
  bucket: string;
  path: string;
  uploaded_at: string;
  expires_on: string | null;
  review_status: ReviewStatus;
  review_note: string | null;
  expired: boolean;
  url?: string | null;
};

type Application = {
  identity: { full_name: string | null; phone: string | null; email: string | null; dui: string | null; nit: string | null };
  independent: boolean;
  provider: string | null;
  services: string[];
  bank: { bank_name: string; account_type: string; account_number: string; holder: string; holder_matches: boolean } | null;
  vehicle: { plate: string; vehicle_type: string; capacity_m3: number | null } | null;
  missing: string[];
  documents: AppDoc[];
};

const PAGE_SIZE = 15;

const VERIF_BADGE: Record<string, string> = {
  approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  review: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  draft: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  suspended: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};
const VERIF_LABEL: Record<string, string> = {
  approved: 'Aprobado',
  review: 'En revisión',
  draft: 'Sin enviar',
  rejected: 'Por corregir',
  suspended: 'Suspendido',
};

const stateOf = (o: OperatorRow) =>
  o.verification_status === 'pending' ? (o.verification_submitted_at ? 'review' : 'draft') : o.verification_status;

type FilterKey = 'review' | 'approved' | 'rejected' | 'suspended' | 'draft' | 'all';

const serviceLabel = (s: string) => PARTNER_SERVICES.find((x) => x.value === s)?.label ?? s;
const vehicleLabel = (v: string) => PARTNER_VEHICLE_TYPES.find((x) => x.value === v)?.label ?? v;

export default function AdminVerificationsPage() {
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('review');
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<OperatorRow | null>(null);
  const [app, setApp] = useState<Application | null>(null);
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

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
        toast.error('No se pudieron cargar los socios operadores.');
        setLoading(false);
        return;
      }

      setOperators(
        (data || []).map((p) => ({
          id: p.id,
          full_name: p.full_name,
          phone: p.phone,
          provider_name: (p.providers as unknown as { name: string } | null)?.name || null,
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

  const filtered = useMemo(
    () => (filter === 'all' ? operators : operators.filter((o) => stateOf(o) === filter)),
    [operators, filter]
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const count = (k: FilterKey) => operators.filter((o) => stateOf(o) === k).length;

  // Ficha completa + URLs firmadas (buckets privados) de cada documento.
  const loadApplication = useCallback(async (op: OperatorRow) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('admin_partner_application', { p_operator_id: op.id });
    if (error) {
      toast.error(error.message);
      setApp(null);
      return;
    }
    const a = data as unknown as Application;
    const docs = await Promise.all(
      a.documents.map(async (d) => {
        const { data: s } = await supabase.storage.from(d.bucket).createSignedUrl(d.path, 300);
        return { ...d, url: s?.signedUrl ?? null };
      })
    );
    setApp({ ...a, documents: docs });
  }, [toast]);

  const openOperator = (op: OperatorRow) => {
    setSelected(op);
    setReason('');
    setApp(null);
    loadApplication(op);
  };

  const close = () => {
    setSelected(null);
    setApp(null);
    setReason('');
  };

  const reviewDoc = async (d: AppDoc, status: 'approved' | 'rejected', note?: string, expires?: string) => {
    if (!selected) return;
    const { data, error } = await createClient().rpc('admin_review_document', {
      p_operator_id: selected.id,
      p_doc_type: d.doc_type,
      p_status: status,
      ...(note ? { p_note: note } : {}),
      ...(expires ? { p_expires_on: expires } : {}),
    });
    if (error) return toast.error(error.message);
    if ((data as { reactivated?: boolean } | null)?.reactivated) {
      toast.success('Documento aprobado: la cuenta del socio se reactivó.');
      refetch();
    } else {
      toast.success(status === 'approved' ? `${DOC_LABEL[d.doc_type]}: aprobado.` : `${DOC_LABEL[d.doc_type]}: marcado para corregir.`);
    }
    loadApplication(selected);
  };

  const decide = async (status: 'approved' | 'rejected' | 'suspended') => {
    if (!selected) return;
    if (status === 'suspended') {
      const ok = await confirm({
        title: `¿Pausar la cuenta de ${selected.full_name ?? 'este socio'}?`,
        message:
          'No recibirá solicitudes nuevas ni se le podrán asignar. Si tiene un servicio en curso, ese sigue: revísalo en Solicitudes. Se le avisa con el motivo.',
        confirmLabel: 'Pausar cuenta',
        destructive: true,
      });
      if (!ok) return;
    }
    setActing(true);
    const { error } = await createClient().rpc('admin_set_operator_verification', {
      p_operator_id: selected.id,
      p_status: status,
      ...(reason.trim() ? { p_reason: reason.trim() } : {}),
    });
    setActing(false);
    if (error) return toast.error(error.message);
    toast.success(
      status === 'approved' ? 'Socio operador aprobado.' : status === 'suspended' ? 'Cuenta en pausa.' : 'Registro devuelto para corregir.'
    );
    close();
    refetch();
  };

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: 'review', label: `En revisión${count('review') ? ` (${count('review')})` : ''}` },
    { key: 'suspended', label: `Suspendidos${count('suspended') ? ` (${count('suspended')})` : ''}` },
    { key: 'rejected', label: 'Por corregir' },
    { key: 'draft', label: 'Sin enviar' },
    { key: 'approved', label: 'Aprobados' },
    { key: 'all', label: 'Todos' },
  ];

  const allApproved = !!app && DOCS.every((d) => app.documents.some((x) => x.doc_type === d.type && x.review_status === 'approved' && !x.expired));
  const anyRejected = !!app && app.documents.some((d) => d.review_status === 'rejected');

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Verificaciones</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Revisa cada documento de los socios operadores; con todo aprobado y vigente, activa la cuenta
        </p>
      </div>

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

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                {['Socio operador', 'Teléfono', 'Empresa', 'Enviado', 'Estado'].map((h) => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-sm text-zinc-500">Cargando…</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <Inbox className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                    <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      {filter === 'review' ? 'No hay socios operadores esperando revisión' : 'No hay socios operadores en este filtro'}
                    </p>
                  </td>
                </tr>
              ) : (
                paged.map((op) => (
                  <tr key={op.id} onClick={() => openOperator(op)} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-zinc-900 dark:text-white">{op.full_name || 'Sin nombre'}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">{op.phone || '-'}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">{op.provider_name || 'Independiente'}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-500">{formatDate(op.verification_submitted_at)}</td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${VERIF_BADGE[stateOf(op)] ?? VERIF_BADGE.draft}`}>
                        {VERIF_LABEL[stateOf(op)] ?? stateOf(op)}
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

      {selected && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={close} aria-hidden="true" />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-y-auto border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">{selected.full_name || 'Socio operador'}</h2>
                <p className="text-sm text-zinc-500">
                  <span className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${VERIF_BADGE[stateOf(selected)]}`}>{VERIF_LABEL[stateOf(selected)]}</span>
                  {selected.phone || 'Sin teléfono'}
                </p>
              </div>
              <button onClick={close} aria-label="Cerrar" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 p-6">
              {selected.verification_rejection_reason && (stateOf(selected) === 'rejected' || stateOf(selected) === 'suspended') && (
                <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                  Motivo actual: {selected.verification_rejection_reason}
                </p>
              )}

              {/* 00126 (AGT-04): qué contrato aceptó, cuándo y desde dónde. */}
              <PartnerTermsEvidence operatorId={selected.id} />
              <PartnerTrainingStatus operatorId={selected.id} />

              {!app ? (
                <p className="text-sm text-zinc-500">Cargando registro…</p>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-zinc-50 p-4 text-sm dark:bg-zinc-800/60">
                    <Field k="DUI" v={app.identity.dui} />
                    <Field k="NIT" v={app.identity.nit} />
                    <Field k="Correo" v={app.identity.email} />
                    <Field k="Empresa" v={app.independent ? 'Independiente' : app.provider} />
                    <Field k="Unidad" v={app.vehicle ? `${app.vehicle.plate} · ${vehicleLabel(app.vehicle.vehicle_type)}${app.vehicle.capacity_m3 ? ` · ${app.vehicle.capacity_m3} m³` : ''}` : null} />
                    {app.independent && <Field k="Servicios" v={app.services.length ? app.services.map(serviceLabel).join(', ') : null} />}
                    {app.independent && (
                      <div className="col-span-2">
                        <dt className="text-xs text-zinc-500">Cuenta bancaria</dt>
                        <dd className="text-zinc-900 dark:text-white">
                          {app.bank ? (
                            <>
                              {app.bank.bank_name} · {app.bank.account_type} · <span className="font-mono">{app.bank.account_number}</span> · {app.bank.holder}
                              {!app.bank.holder_matches && (
                                <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                                  <AlertTriangle className="h-3.5 w-3.5" /> el titular no coincide con el nombre
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-zinc-400">Sin cargar</span>
                          )}
                        </dd>
                      </div>
                    )}
                  </dl>

                  {app.missing.length > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">Le falta: {app.missing.join(', ')}</p>
                  )}

                  <div className="space-y-4">
                    {DOCS.map((spec) => {
                      const d = app.documents.find((x) => x.doc_type === spec.type);
                      return d ? (
                        <DocReview key={spec.type} doc={d} expires={spec.expires} onReview={reviewDoc} />
                      ) : (
                        <div key={spec.type} className="rounded-lg border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700">
                          {spec.label}: sin subir
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="sticky bottom-0 space-y-3 border-t border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  stateOf(selected) === 'approved'
                    ? 'Motivo de la pausa (le llega al socio)'
                    : anyRejected
                      ? 'Motivo (opcional: si lo dejas vacío se usan las notas de los documentos)'
                      : 'Motivo para devolver el registro'
                }
                rows={2}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              />
              {stateOf(selected) === 'approved' ? (
                <button
                  onClick={() => decide('suspended')}
                  disabled={acting || !reason.trim()}
                  title={reason.trim() ? undefined : 'Escribe el motivo'}
                  className="w-full rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950"
                >
                  Pausar cuenta
                </button>
              ) : (
              <div className="flex gap-3">
                <button
                  onClick={() => decide('rejected')}
                  disabled={acting}
                  className="flex-1 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950"
                >
                  Devolver para corregir
                </button>
                <button
                  onClick={() => decide('approved')}
                  disabled={acting || !allApproved}
                  title={allApproved ? undefined : 'Aprueba primero cada documento (vigente)'}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <ShieldCheck className="h-4 w-4" /> Activar cuenta
                </button>
              </div>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function Field({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{k}</dt>
      <dd className="text-zinc-900 dark:text-white">{v || <span className="text-zinc-400">Sin cargar</span>}</dd>
    </div>
  );
}

function DocReview({
  doc,
  expires,
  onReview,
}: {
  doc: AppDoc;
  expires: boolean;
  onReview: (d: AppDoc, status: 'approved' | 'rejected', note?: string, expires?: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [exp, setExp] = useState(doc.expires_on ?? '');
  const badge =
    doc.expired ? (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><AlertTriangle className="h-3.5 w-3.5" /> Vencido</span>
    ) : doc.review_status === 'approved' ? (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600"><CheckCircle2 className="h-3.5 w-3.5" /> Aprobado</span>
    ) : doc.review_status === 'rejected' ? (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><XCircle className="h-3.5 w-3.5" /> Por corregir</span>
    ) : (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><Clock className="h-3.5 w-3.5" /> Por revisar</span>
    );
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{DOC_LABEL[doc.doc_type]}</p>
        <div className="flex items-center gap-3">
          {badge}
          <span className="text-xs text-zinc-500">subido {formatDate(doc.uploaded_at)}</span>
        </div>
      </div>
      {doc.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL firmada de un bucket privado
        <img src={doc.url} alt={DOC_LABEL[doc.doc_type]} className="max-h-72 w-full rounded-md border border-zinc-200 object-contain dark:border-zinc-700" />
      ) : (
        <p className="text-sm text-red-500">No se pudo cargar la imagen.</p>
      )}
      {doc.review_status === 'rejected' && doc.review_note && <p className="mt-2 text-xs text-red-600">Nota enviada: {doc.review_note}</p>}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {expires && (
          <label className="text-xs text-zinc-600 dark:text-zinc-400">
            Vence
            <input
              type="date"
              value={exp}
              onChange={(e) => setExp(e.target.value)}
              className="ml-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </label>
        )}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Qué corregir (para rechazar)"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        />
        <button
          onClick={() => onReview(doc, 'rejected', note.trim())}
          disabled={note.trim().length < 3}
          className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-800"
        >
          Rechazar
        </button>
        <button
          onClick={() => onReview(doc, 'approved', undefined, expires && exp !== doc.expires_on ? exp : undefined)}
          className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700"
        >
          Aprobar
        </button>
      </div>
    </div>
  );
}
