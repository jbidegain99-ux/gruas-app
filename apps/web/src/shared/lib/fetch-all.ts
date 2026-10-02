// PostgREST corta cada respuesta en max_rows (1000, supabase/config.toml) sin
// avisar: una lista que se filtra o se cuenta en el navegador quedaba incompleta
// en silencio pasadas las 1000 filas. Esto pide por tandas hasta agotar.

/** Las filas que devuelve el servidor como máximo por respuesta (max_rows). */
export const PAGE_ROWS = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Trae todas las filas de una consulta, de `PAGE_ROWS` en `PAGE_ROWS`.
 * `page(from, to)` es la consulta con `.range(from, to)`; necesita un orden
 * estable (p. ej. `.order('created_at').order('id')`) para no repetir ni saltar filas.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => Page<T>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_ROWS) return { data: rows, error: null };
  }
}
