// Exportar una tabla a CSV o Excel (backlog POR-03). La usan los portales
// (aseguradora y MOPT): exportan exactamente las filas que la persona tiene
// en pantalla, con sus filtros, y nada que la base no le haya entregado.

import { buildXlsx, type Cell } from './xlsx';

export type ExportColumn<T> = { header: string; value: (row: T) => Cell };

export function tableRows<T>(rows: T[], columns: ExportColumn<T>[]): Cell[][] {
  return [columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => c.value(r)))];
}

function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Fórmulas: una celda que empieza con = + - @ se ejecutaría en Excel. Un
  // monto que llega como texto ("-12.00", un saldo negativo) no es fórmula:
  // con el apóstrofo Excel lo dejaría como texto y no sumaría.
  const esNumero = typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(s);
  const safe = !esNumero && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function download(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportTable<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  format: 'csv' | 'xlsx',
  basename: string
): void {
  exportMatrix(tableRows(rows, columns), format, basename);
}

/** Igual, para una hoja ya armada (p. ej. varias secciones en un solo archivo). */
export function exportMatrix(matrix: Cell[][], format: 'csv' | 'xlsx', basename: string): void {
  if (format === 'csv') {
    // BOM: sin él, Excel abre el UTF-8 como Latin-1 y rompe las tildes.
    download('﻿' + toCsv(matrix), 'text/csv;charset=utf-8', `${basename}.csv`);
  } else {
    const bytes = buildXlsx(matrix, basename);
    download(bytes as unknown as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${basename}.xlsx`);
  }
}
