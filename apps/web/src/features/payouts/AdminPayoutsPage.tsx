'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Banknote, Download, Paperclip } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useConfirm, useToast } from '@/shared/components/FeedbackProvider';
import { svToday } from '@/shared/components/LedgerPaymentModals';
import { buildXlsx } from '@/shared/lib/export/xlsx';
import { toCsv } from '@/shared/lib/export/table-export';
import { formatDate, money } from '@/shared/lib/format';
import { bankFileRows, batchTotals, receiptPath, type PayoutBatch } from './payout-file';

// Pagos a socios operadores (migr. 00125, LAN-08): preparar el lote con lo
// que Budi debe a la fecha de corte, bajar el archivo para el banco y, una vez
// hecha la transferencia, marcarlo pagado con referencia y comprobante.

type BatchRow = {
  id: string; number: string | null; cutoff: string; status: PayoutBatch['status']; created_at: string;
  paid_on: string | null; reference: string | null; payees: number; missing_bank: number; total: number;
};

const STATUS: Record<PayoutBatch['status'], string> = { draft: 'Borrador', paid: 'Pagado', void: 'Descartado' };

function download(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AdminPayoutsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [batches, setBatches] = useState<BatchRow[] | null>(null);
  const [selected, setSelected] = useState<PayoutBatch | null>(null);
  const [cutoff, setCutoff] = useState(svToday());
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((k) => k + 1), []);

  useEffect(() => {
    createClient()
      .rpc('admin_list_payout_batches')
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setBatches((data as BatchRow[]) ?? []);
      });
  }, [refresh, toast]);

  const open = async (id: string) => {
    const { data, error } = await createClient().rpc('admin_payout_batch', { p_id: id });
    if (error) return toast.error(error.message);
    setSelected(data as unknown as PayoutBatch);
  };

  const prepare = async () => {
    const { data, error } = await createClient().rpc('admin_create_payout_batch', { p_cutoff: cutoff });
    if (error) return toast.error(error.message);
    toast.success('Lote preparado. Revisa y baja el archivo para el banco.');
    reload();
    open(data as string);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Pagos a socios</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Lo que Budi les debe a los socios operadores y empresas de grúas por los servicios particulares y cubiertos. Los de la
          flota MOPT los paga el MOPT desde su portal.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="flex flex-col text-xs text-zinc-500">
          Servicios completados hasta
          <input
            type="date"
            value={cutoff}
            max={svToday()}
            onChange={(e) => e.target.value && setCutoff(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />
        </label>
        <button onClick={prepare} className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700">
          Preparar lote
        </button>
        <p className="w-full text-xs text-zinc-500">Si ya hay un borrador, se recalcula con los saldos de ahora.</p>
      </div>

      {selected && (
        <BatchDetail
          batch={selected}
          onChanged={() => {
            reload();
            open(selected.id);
          }}
          onDiscarded={() => {
            setSelected(null);
            reload();
          }}
          onClose={() => setSelected(null)}
          confirm={confirm}
        />
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Lote</th>
              <th className="px-4 py-3">Corte</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3 text-right">Destinatarios</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {(batches ?? []).length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">{batches ? 'Todavía no hay lotes de pago.' : 'Cargando…'}</td></tr>
            ) : (
              batches!.map((b) => (
                <tr key={b.id} onClick={() => open(b.id)} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="px-4 py-3 font-mono text-xs">{b.number ?? (b.status === 'draft' ? 'Borrador' : '—')}</td>
                  <td className="px-4 py-3">{formatDate(b.cutoff)}</td>
                  <td className="px-4 py-3">
                    {STATUS[b.status]}
                    {b.status === 'draft' && b.missing_bank > 0 && (
                      <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">{b.missing_bank} sin cuenta</span>
                    )}
                    {b.paid_on && <span className="ml-2 text-xs text-zinc-500">el {formatDate(b.paid_on)} · {b.reference}</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{b.payees}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{money(Number(b.total))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BatchDetail({
  batch, onChanged, onDiscarded, onClose, confirm,
}: {
  batch: PayoutBatch;
  onChanged: () => void;
  onDiscarded: () => void;
  onClose: () => void;
  confirm: ReturnType<typeof useConfirm>;
}) {
  const toast = useToast();
  const [paidOn, setPaidOn] = useState(svToday());
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const t = batchTotals(batch.items);
  const draft = batch.status === 'draft';

  const bankFile = (format: 'csv' | 'xlsx') => {
    const rows = bankFileRows(batch, batch.items);
    const name = `pago_socios_${batch.cutoff}`;
    if (format === 'csv') download('﻿' + toCsv(rows), 'text/csv;charset=utf-8', `${name}.csv`);
    else download(buildXlsx(rows, 'Pago') as unknown as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${name}.xlsx`);
  };

  const markPaid = async () => {
    const ok = await confirm({
      title: `¿Confirmas que el banco pagó ${money(t.total)}?`,
      message: `Se registra un pago en el libro para cada uno de los ${t.payable} destinatarios y se les avisa. ${
        t.missingBank ? `Los ${t.missingBank} sin cuenta quedan pendientes para el próximo lote.` : ''
      }`,
      confirmLabel: 'Marcar pagado',
    });
    if (!ok) return;
    setBusy(true);
    let path: string | null = null;
    if (file) {
      path = receiptPath(batch.id, file.name);
      const { error } = await createClient().storage.from('payout-receipts').upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        setBusy(false);
        return toast.error(`No se pudo subir el comprobante: ${error.message}`);
      }
    }
    const { error } = await createClient().rpc('admin_mark_payout_paid', {
      p_id: batch.id, p_paid_on: paidOn, p_reference: reference, p_receipt_path: path,
    } as never);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Lote pagado. Los socios ya lo ven en su app.');
    onChanged();
  };

  const discard = async () => {
    const ok = await confirm({ title: '¿Descartar el borrador?', confirmLabel: 'Descartar', destructive: true });
    if (!ok) return;
    const { error } = await createClient().rpc('admin_void_payout_batch', { p_id: batch.id });
    if (error) return toast.error(error.message);
    onDiscarded();
  };

  const openReceipt = async () => {
    if (!batch.receipt_path) return;
    const { data, error } = await createClient().storage.from('payout-receipts').createSignedUrl(batch.receipt_path, 120);
    if (error || !data) return toast.error('No se pudo abrir el comprobante.');
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const input = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

  return (
    <section className="rounded-xl border border-budi-primary-200 bg-white p-5 dark:border-budi-primary-900 dark:bg-zinc-900">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-zinc-900 dark:text-white">
            {batch.number ?? 'Lote en borrador'} · corte {formatDate(batch.cutoff)}
          </h2>
          <p className="text-sm text-zinc-500">
            {t.payable} con cuenta · {money(t.total)}
            {t.missingBank > 0 && ` · ${t.missingBank} sin cuenta (${money(t.withheld)} retenido)`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => bankFile('csv')} disabled={t.payable === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            <Download className="h-4 w-4" /> Archivo banco (CSV)
          </button>
          <button onClick={() => bankFile('xlsx')} disabled={t.payable === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            <Download className="h-4 w-4" /> Excel
          </button>
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cerrar</button>
        </div>
      </div>

      {t.missingBank > 0 && draft && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Hay destinatarios sin cuenta bancaria: no entran al archivo. Carga la cuenta de la empresa en Proveedores (o el socio en
          su registro) y vuelve a preparar el lote.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Destinatario</th>
              <th className="px-3 py-2">Cuenta</th>
              <th className="px-3 py-2 text-right">Servicios</th>
              <th className="px-3 py-2 text-right">Monto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {batch.items.map((i) => {
              const key = `${i.payee_kind}:${i.payee_id}`;
              return (
                <tr key={key} className={!i.account_number ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-zinc-900 dark:text-white">{i.payee_name}</p>
                    <p className="text-xs text-zinc-500">{i.payee_kind === 'provider' ? 'Empresa de grúas' : 'Socio independiente'}</p>
                  </td>
                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                    {i.account_number ? `${i.bank_name} · ${i.account_type} · ${i.account_number}` : <span className="text-amber-700 dark:text-amber-300">Sin cuenta</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setExpanded(expanded === key ? null : key)} className="text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                      {i.services.length}
                    </button>
                    {expanded === key && (
                      <ul className="mt-1 text-left text-xs text-zinc-500">
                        {i.services.map((s, n) => (
                          <li key={n}>{s.folio ?? '—'} · {formatDate(s.completed_at)} · {money(Number(s.amount))}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{money(Number(i.amount))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {draft ? (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <label className="flex flex-col text-xs text-zinc-500">
            Fecha del pago
            <input type="date" value={paidOn} max={svToday()} onChange={(e) => setPaidOn(e.target.value)} className={input} />
          </label>
          <label className="flex flex-col text-xs text-zinc-500">
            Referencia del banco
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={input} placeholder="Ej. TRF-000123" />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
            <Paperclip className="h-4 w-4" />
            {file ? file.name : 'Comprobante (opcional)'}
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button
            onClick={markPaid}
            disabled={busy || !reference.trim() || t.payable === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            <Banknote className="h-4 w-4" /> Marcar pagado
          </button>
          <button onClick={discard} className="ml-auto text-sm text-red-600 hover:underline">Descartar borrador</button>
        </div>
      ) : (
        batch.status === 'paid' && (
          <p className="mt-4 border-t border-zinc-200 pt-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            Pagado el {formatDate(batch.paid_on)} · referencia {batch.reference}
            {batch.receipt_path && (
              <button onClick={openReceipt} className="ml-2 inline-flex items-center gap-1 text-budi-primary-600 hover:underline dark:text-budi-primary-400">
                <Paperclip className="h-3.5 w-3.5" /> Ver comprobante
              </button>
            )}
          </p>
        )
      )}
    </section>
  );
}
