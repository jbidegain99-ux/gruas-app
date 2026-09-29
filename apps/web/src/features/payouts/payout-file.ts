// Archivo de pago masivo para el banco (backlog LAN-08, migr. 00125).
//
// Formato genérico en CSV: cada banco de El Salvador (Agrícola, Cuscatlán,
// Davivienda, BAC…) tiene su plantilla de "pago a terceros". Cuando se elija
// el banco de Budi, esta función es el único lugar que cambia.

import type { Cell } from '@/shared/lib/export/xlsx';

export type PayoutItem = {
  payee_kind: 'provider' | 'operator';
  payee_id: string;
  payee_name: string | null;
  amount: number;
  bank_name: string | null;
  account_type: string | null;
  account_number: string | null;
  holder: string | null;
  services: { folio: string | null; completed_at: string; service_type: string; amount: number }[];
  ledger_payment_id: string | null;
};

export type PayoutBatch = {
  id: string;
  number: string | null;
  cutoff: string;
  status: 'draft' | 'paid' | 'void';
  created_at: string;
  paid_on: string | null;
  reference: string | null;
  receipt_path: string | null;
  items: PayoutItem[];
};

/** Solo quien tiene cuenta bancaria entra al archivo. */
export function payable(items: PayoutItem[]): PayoutItem[] {
  return items.filter((i) => !!i.account_number && Number(i.amount) > 0);
}

/** Filas del archivo del banco (la primera, títulos). */
export function bankFileRows(batch: Pick<PayoutBatch, 'cutoff'>, items: PayoutItem[]): Cell[][] {
  const ref = `Budi servicios al ${batch.cutoff}`;
  return [
    ['Banco', 'Tipo de cuenta', 'Número de cuenta', 'Titular', 'Monto', 'Concepto'],
    ...payable(items).map((i) => [
      i.bank_name,
      i.account_type === 'corriente' ? 'Corriente' : 'Ahorro',
      i.account_number,
      i.holder ?? i.payee_name,
      // Texto con dos decimales: las plantillas de los bancos lo piden así.
      Number(i.amount).toFixed(2),
      ref,
    ]),
  ];
}

export function batchTotals(items: PayoutItem[]) {
  const ok = payable(items);
  return {
    payees: items.length,
    payable: ok.length,
    missingBank: items.length - ok.length,
    total: ok.reduce((a, i) => a + Number(i.amount), 0),
    withheld: items.filter((i) => !i.account_number).reduce((a, i) => a + Number(i.amount), 0),
  };
}

/** Ruta única del comprobante en el bucket privado (la base exige `lotes/…`). */
export function receiptPath(batchId: string, fileName: string, now = Date.now()): string {
  const ext = (fileName.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf';
  return `lotes/${batchId}-${now}.${ext}`;
}
