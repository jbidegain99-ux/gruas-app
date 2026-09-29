// Importación del padrón en lotes (ASE-02, migr. 00127). El rol authenticated
// tiene 8 s por consulta: un archivo de 10 000 filas se manda en lotes y los
// resultados se juntan en un solo informe, con la fila real del archivo.

export const IMPORT_CHUNK = 1000;

export type ImportResult = {
  inserted: number;
  updated: number;
  failed: number;
  errors: { row: number; document_number: string; message: string }[];
};

export function chunk<T>(rows: T[], size = IMPORT_CHUNK): { offset: number; rows: T[] }[] {
  const out: { offset: number; rows: T[] }[] = [];
  for (let i = 0; i < rows.length; i += size) out.push({ offset: i, rows: rows.slice(i, i + size) });
  return out;
}

/**
 * Suma los resultados de cada lote. `rowsAlreadyOffset`: la RPC del portal ya
 * numera sobre el archivo completo; la del admin numera dentro del lote.
 */
export function mergeResults(
  parts: { offset: number; result: ImportResult }[],
  rowsAlreadyOffset: boolean
): ImportResult {
  return parts.reduce<ImportResult>(
    (acc, { offset, result }) => ({
      inserted: acc.inserted + result.inserted,
      updated: acc.updated + result.updated,
      failed: acc.failed + result.failed,
      errors: [...acc.errors, ...result.errors.map((e) => ({ ...e, row: rowsAlreadyOffset ? e.row : e.row + offset }))],
    }),
    { inserted: 0, updated: 0, failed: 0, errors: [] }
  );
}
