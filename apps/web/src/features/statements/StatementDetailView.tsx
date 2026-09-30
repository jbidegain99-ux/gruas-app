'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { DteDraftPanel } from '@/features/billing/DteDraftPanel';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Download, FileText, MessageSquareWarning, Printer } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useConfirm, useToast } from '@/shared/components/FeedbackProvider';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { serviceTypeLabel } from '@/shared/components/ServiceTypeBadge';
import { exportTable, type ExportColumn } from '@/shared/lib/export/table-export';
import { formatDate, formatDateTime, money } from '@/shared/lib/format';
import {
  EVENT_LABEL,
  OBSERVATION_LABEL,
  STATUS_LABEL,
  STATUS_STYLE,
  countedTotal,
  effectiveAmount,
  effectiveFee,
  periodLabel,
  type StatementDetail,
  type StatementLine,
} from './statement-types';

// Detalle de un estado de cuenta (migr. 00123). Lo usan el admin (Budi) y los
// portales (MOPT y aseguradora): la base decide qué puede hacer cada uno
// (`viewer`, `can_approve`, `can_observe`) y aquí solo se muestran esos botones.
// "Descargar PDF" imprime la página: los shells se ocultan al imprimir.

const km = (n: number | null) => (n == null ? '—' : `${Number(n).toFixed(1)} km`);

export function StatementDetailView({ id, backHref }: { id: string; backHref: string }) {
  const [d, setD] = useState<StatementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const reload = useCallback(() => setRefresh((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    createClient()
      .rpc('statement_detail', { p_id: id })
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e) setError(e.message);
        else setD(data as unknown as StatementDetail);
      });
    return () => {
      alive = false;
    };
  }, [id, refresh]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!d) return <p className="text-sm text-zinc-500">Cargando…</p>;

  const isMopt = d.organization.type === 'MOPT';
  const budi = d.viewer === 'budi';
  const t = d.totals;

  const run = async (fn: string, args: Record<string, unknown>, ok: string): Promise<boolean> => {
    const { error: e } = await createClient().rpc(fn as 'statement_detail', args as never);
    if (e) {
      toast.error(e.message);
      return false;
    }
    toast.success(ok);
    reload();
    return true;
  };
  // El admin lee lo mismo que el cliente, pero desde el lado de Budi.
  const covered = budi ? 'A cargo de la aseguradora' : 'A cargo de tus pólizas';

  const approve = async () => {
    // 00141: con casos observados sin respuesta de Budi la base no deja aprobar.
    if (t.observed_open > 0) return;
    const ok = await confirm({
      title: `¿Aprobar ${money(t.approvable)}?`,
      message: 'Al aprobar confirmas los servicios y montos de este estado de cuenta.',
      confirmLabel: 'Aprobar',
    });
    if (!ok) return;
    // Sin doble clic mientras la RPC corre.
    setApproving(true);
    await run('approve_statement', { p_id: d.id }, 'Estado de cuenta aprobado.');
    setApproving(false);
  };

  const exportLines = (format: 'csv' | 'xlsx') => {
    const cols: ExportColumn<StatementLine>[] = [
      { header: 'Folio', value: (l) => l.folio },
      { header: 'Completado', value: (l) => formatDateTime(l.completed_at) },
      { header: 'Servicio', value: (l) => serviceTypeLabel(l.service_type) },
      ...(isMopt ? [{ header: 'Proveedor', value: (l: StatementLine) => l.provider_name }] : []),
      { header: 'Km de arrastre', value: (l) => (l.tow_km == null ? null : Number(l.tow_km)) },
      { header: 'Km totales', value: (l) => (l.total_km == null ? null : Number(l.total_km)) },
      { header: isMopt ? 'Monto del servicio (USD)' : `${covered} (USD)`, value: (l) => Number(l.amount) },
      ...(isMopt ? [{ header: 'Tarifa de plataforma (USD)', value: (l: StatementLine) => Number(l.fee) }] : []),
      ...(!isMopt ? [{ header: 'Copago del afiliado (USD)', value: (l: StatementLine) => (l.copay == null ? null : Number(l.copay)) }] : []),
      { header: 'Observación', value: (l) => (l.observation ? OBSERVATION_LABEL[l.observation.status] : null) },
      // Lo que cuenta, con la misma regla que statement_totals: la columna
      // "Total que cuenta" suma exactamente el "Total a aprobar" (incluye la
      // tarifa de plataforma, recalculada en proporción si hubo ajuste).
      ...(isMopt
        ? [
            { header: 'Monto que cuenta (USD)', value: (l: StatementLine) => (l.observation?.status === 'open' ? null : effectiveAmount(l)) },
            { header: 'Tarifa que cuenta (USD)', value: (l: StatementLine) => (l.observation?.status === 'open' ? null : effectiveFee(l)) },
          ]
        : []),
      { header: 'Total que cuenta (USD)', value: (l) => (l.observation?.status === 'open' ? null : countedTotal(l)) },
    ];
    exportTable(d.lines, cols, format, `estado_de_cuenta_${d.number ?? 'borrador'}`);
  };

  return (
    <div className="space-y-6">
      <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 print:hidden">
        <ArrowLeft className="h-4 w-4" /> Estados de cuenta
      </Link>

      {/* Encabezado (en papel también) */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 hidden items-center gap-2 print:flex">
            <BudiLogo /> <span className="font-heading text-lg font-bold">Budi — Estado de cuenta</span>
          </div>
          <p className="text-sm text-zinc-500">{d.organization.name}</p>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">
            {periodLabel(d.period_from, d.period_to)}
            <span className={`ml-3 align-middle rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[d.status]}`}>
              {STATUS_LABEL[d.status]}
            </span>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {d.number ?? 'Sin número (borrador)'} · del {formatDate(d.period_from)} al {formatDate(d.period_to)}
            {d.issued_at && ` · emitido ${formatDate(d.issued_at, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/El_Salvador' })}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
            <Printer className="h-4 w-4" /> PDF
          </button>
          <button onClick={() => exportLines('xlsx')} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
            <Download className="h-4 w-4" /> Excel
          </button>
        </div>
      </div>

      {/* Totales */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Box label="Servicios" value={String(t.services)} />
        {isMopt ? (
          <>
            <Box label="Servicios a proveedores" value={money(t.amount)} />
            <Box label="Tarifa de plataforma" value={money(t.fee)} />
          </>
        ) : (
          <>
            <Box label={covered} value={money(t.amount)} />
            <Box label="Copagos de afiliados" value={money(t.copay)} sub="Informativo: lo pagó el afiliado" />
          </>
        )}
        <Box
          label={d.status === 'approved' || d.status === 'paid' ? 'Total aprobado' : 'Total a aprobar'}
          value={money(d.approved_amount ?? t.approvable)}
          sub={t.observed_open > 0 ? `${t.observed_open} observado(s) fuera: ${money(t.observed_open_amount)}` : undefined}
          strong
        />
      </div>

      {(d.approved_at || d.paid_at || d.void_reason) && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {d.approved_at && <p>Aprobado el {formatDateTime(d.approved_at)}{d.approved_by ? ` por ${d.approved_by}` : ''}.</p>}
          {d.paid_at && <p>Pagado el {formatDate(d.paid_at)} · referencia {d.paid_reference}.</p>}
          {d.void_reason && <p className="text-red-600">Anulado: {d.void_reason}</p>}
        </div>
      )}

      {/* Acciones */}
      <div className="print:hidden">
        {budi ? <BudiActions d={d} run={run} /> : null}
        {/* LAN-09 (base): borrador del DTE del estado de cuenta aprobado. */}
        <DteDraftPanel d={d} />
        {d.can_approve && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={approve}
              disabled={approving || t.observed_open > 0}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" /> {approving ? 'Aprobando…' : `Aprobar ${money(t.approvable)}`}
            </button>
            {t.observed_open > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Hay {t.observed_open} caso(s) observado(s) esperando respuesta de Budi. Podrás aprobar cuando estén resueltos.
              </p>
            )}
          </div>
        )}
        {!budi && d.status === 'issued' && !d.can_approve && (
          <p className="text-sm text-zinc-500">
            {d.can_observe
              ? 'Puedes observar casos. La aprobación la hace el dueño o un administrador del portal.'
              : 'Tu rol es de solo lectura.'}
          </p>
        )}
      </div>

      {/* Por proveedor (MOPT) */}
      {isMopt && d.by_provider.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold text-zinc-900 dark:text-white">Por proveedor</h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Socio o empresa</th>
                  <th className="px-4 py-2 text-right">Servicios</th>
                  <th className="px-4 py-2 text-right">Km de arrastre</th>
                  <th className="px-4 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {d.by_provider.map((p) => (
                  <tr key={p.provider_id ?? p.provider_name}>
                    <td className="px-4 py-2 text-zinc-900 dark:text-white">{p.provider_name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.services}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{km(p.tow_km)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{money(Number(p.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Servicios */}
      <section>
        <h2 className="mb-2 font-semibold text-zinc-900 dark:text-white">Servicios</h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2">Folio</th>
                <th className="px-4 py-2">Completado</th>
                <th className="px-4 py-2">Servicio</th>
                {isMopt && <th className="px-4 py-2">Proveedor</th>}
                <th className="px-4 py-2 text-right">Km</th>
                <th className="px-4 py-2 text-right">{isMopt ? 'Monto' : budi ? 'Aseguradora' : 'A tu cargo'}</th>
                {isMopt ? <th className="px-4 py-2 text-right">Tarifa</th> : <th className="px-4 py-2 text-right">Copago</th>}
                <th className="px-4 py-2 print:hidden" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {d.lines.map((l) => {
                const ob = l.observation;
                const expanded = openLine === l.request_id;
                return (
                  <Fragment key={l.request_id}>
                    <tr className={ob?.status === 'open' ? 'bg-amber-50 dark:bg-amber-950/30' : ''}>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{l.folio ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-zinc-600 dark:text-zinc-400">{formatDateTime(l.completed_at)}</td>
                      <td className="px-4 py-2">{serviceTypeLabel(l.service_type)}</td>
                      {isMopt && <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{l.provider_name ?? '—'}</td>}
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{km(l.total_km)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                        {ob?.status === 'adjusted' ? (
                          <>
                            <span className="mr-1 text-xs text-zinc-400 line-through">{money(Number(l.amount))}</span>
                            {money(effectiveAmount(l))}
                          </>
                        ) : (
                          money(Number(l.amount))
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                        {isMopt ? (
                          ob?.status === 'adjusted' ? (
                            <>
                              <span className="mr-1 text-xs text-zinc-400 line-through">{money(Number(l.fee))}</span>
                              {money(effectiveFee(l))}
                            </>
                          ) : (
                            money(Number(l.fee))
                          )
                        ) : l.copay == null ? '—' : money(Number(l.copay))}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right print:hidden">
                        {ob || d.can_observe || budi ? (
                          <button
                            onClick={() => setOpenLine(expanded ? null : l.request_id)}
                            className={`inline-flex items-center gap-1 text-xs font-medium ${ob?.status === 'open' ? 'text-amber-700 dark:text-amber-300' : 'text-budi-primary-600 dark:text-budi-primary-400'} hover:underline`}
                          >
                            <MessageSquareWarning className="h-3.5 w-3.5" />
                            {ob ? OBSERVATION_LABEL[ob.status] : d.can_observe ? 'Observar' : ''}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={isMopt ? 8 : 7} className="bg-zinc-50 px-4 py-3 dark:bg-zinc-800/40">
                          <ObservationThread d={d} line={l} run={run} />
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
      <p className="hidden text-xs text-zinc-500 print:block">
        Generado por Budi el {formatDateTime(new Date())}. Montos en dólares de los Estados Unidos.
      </p>
    </div>
  );
}

function Box({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${strong ? 'border-budi-primary-200 bg-budi-primary-50 dark:border-budi-primary-900 dark:bg-budi-primary-950/40' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'}`}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-zinc-900 dark:text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

type Run = (fn: string, args: Record<string, unknown>, ok: string) => Promise<boolean>;

function ObservationThread({ d, line, run }: { d: StatementDetail; line: StatementLine; run: Run }) {
  const [body, setBody] = useState('');
  const [adjust, setAdjust] = useState('');
  const ob = line.observation;
  const budi = d.viewer === 'budi';
  // 00141: Budi responde observaciones solo mientras el estado de cuenta está emitido.
  const canAnswer = budi && ob && d.status === 'issued';
  const send = async (fn: string, args: Record<string, unknown>, ok: string) => {
    if (await run(fn, args, ok)) {
      setBody('');
      setAdjust('');
    }
  };

  return (
    <div className="space-y-3">
      {ob?.events.map((e, i) => (
        <div key={i} className={`max-w-xl rounded-lg p-2.5 text-sm ${e.side === 'budi' ? 'ml-auto bg-budi-primary-50 dark:bg-budi-primary-950/40' : 'bg-white dark:bg-zinc-900'}`}>
          <p className="text-xs font-medium text-zinc-500">
            {e.side === 'budi' ? 'Budi' : d.organization.name} · {e.author} · {EVENT_LABEL[e.kind]}
            {e.amount != null && ` a ${money(Number(e.amount))}`} · {formatDateTime(e.at)}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{e.body}</p>
        </div>
      ))}
      {(d.can_observe || canAnswer) && (
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={budi ? 'Respuesta de Budi (la ve el cliente)' : '¿Qué observas de este caso?'}
            className="w-full max-w-xl rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          />
          <div className="flex flex-wrap items-center gap-2">
            {d.can_observe && (
              <button
                disabled={!body.trim()}
                onClick={() => send('observe_statement_case', { p_statement: d.id, p_request: line.request_id, p_body: body }, 'Observación enviada. El caso queda fuera del total hasta que Budi responda.')}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {ob ? 'Agregar al hilo' : 'Observar caso'}
              </button>
            )}
            {canAnswer && (
              <>
                <button
                  disabled={!body.trim()}
                  onClick={() => send('admin_answer_observation', { p_observation: ob.id, p_body: body }, 'Respuesta enviada.')}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-white disabled:opacity-50 dark:border-zinc-600"
                >
                  Responder
                </button>
                <button
                  disabled={!body.trim()}
                  onClick={() => send('admin_answer_observation', { p_observation: ob.id, p_body: body, p_resolution: 'confirmed' }, 'Monto confirmado.')}
                  className="rounded-lg bg-budi-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-budi-primary-700 disabled:opacity-50"
                >
                  Confirmar monto
                </button>
                <input
                  value={adjust}
                  onChange={(e) => setAdjust(e.target.value)}
                  inputMode="decimal"
                  placeholder={`Ajustar (≤ ${Number(line.amount).toFixed(2)})`}
                  className="w-36 rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                />
                <button
                  disabled={!body.trim() || !adjust.trim()}
                  onClick={() =>
                    send('admin_answer_observation', { p_observation: ob.id, p_body: body, p_resolution: 'adjusted', p_adjusted_amount: Number(adjust) }, 'Monto ajustado.')
                  }
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Ajustar
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BudiActions({ d, run }: { d: StatementDetail; run: Run }) {
  const [reason, setReason] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [ref, setRef] = useState('');
  const confirm = useConfirm();
  const cls = 'rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white';

  return (
    <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      {d.status === 'draft' && (
        <button
          onClick={async () => {
            const ok = await confirm({
              title: '¿Emitir el estado de cuenta?',
              message: `El cliente lo verá en su portal y los montos quedan congelados (${d.totals.services} servicios).`,
              confirmLabel: 'Emitir',
            });
            if (ok) run('admin_issue_statement', { p_id: d.id }, 'Estado de cuenta emitido.');
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700"
        >
          <FileText className="h-4 w-4" /> Emitir
        </button>
      )}
      {d.status === 'approved' && (
        <>
          <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={cls} aria-label="Fecha del pago" />
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Referencia del pago" className={cls} />
          <button
            disabled={!paidOn || !ref.trim()}
            onClick={() => run('admin_mark_statement_paid', { p_id: d.id, p_paid_on: paidOn, p_reference: ref }, 'Marcado como pagado.')}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            Marcar pagado
          </button>
        </>
      )}
      {(d.status === 'draft' || d.status === 'issued') && (
        <>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo para anular" className={`${cls} ml-auto`} />
          <button
            disabled={!reason.trim()}
            onClick={() => run('admin_void_statement', { p_id: d.id, p_reason: reason }, 'Estado de cuenta anulado. Sus servicios quedan libres para otro.')}
            className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800"
          >
            Anular
          </button>
        </>
      )}
      {d.status === 'issued' && <p className="text-sm text-zinc-500">Esperando que el cliente lo apruebe.</p>}
    </div>
  );
}
