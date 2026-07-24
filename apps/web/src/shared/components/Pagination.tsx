'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Controles de paginación para tablas del admin. Paginación del lado del cliente:
 * la página filtra/rebana la lista ya cargada. Muestra el rango visible y el total.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number; // base 0
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  if (total <= pageSize) return null;

  return (
    <div className="flex items-center justify-between gap-4 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {from}–{to} de {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 0}
          aria-label="Página anterior"
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <ChevronLeft className="h-4 w-4" />
          Anterior
        </button>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {page + 1} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages - 1}
          aria-label="Página siguiente"
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Siguiente
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
