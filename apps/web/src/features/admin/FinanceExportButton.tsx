'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { fetchAll } from '@/shared/lib/fetch-all';
import { useToast } from '@/shared/components/FeedbackProvider';
import { toCsv } from '@/shared/lib/export/table-export';

type Fila = {
  folio: string | null;
  completado: string;
  servicio: string;
  cliente: string | null;
  operador: string | null;
  proveedor: string | null;
  aseguradora: string | null;
  bruto: number;
  cubierto: number;
  copago: number;
};

/**
 * Exporta el detalle del periodo, una linea por servicio.
 *
 * El resumen no alcanza para cerrar un mes: para conciliar contra lo que reporta
 * la aseguradora hace falta la linea con su folio. Sale del mismo
 * `admin_finance_detail` que alimenta los totales de la pantalla, asi que el
 * archivo y lo que se ve en pantalla no pueden discrepar.
 */
export function FinanceExportButton({ desde, hasta, insurers = true }: { desde: string; hasta: string; insurers?: boolean }) {
  const [bajando, setBajando] = useState(false);
  const toast = useToast();

  const exportar = async () => {
    setBajando(true);
    // Por tandas: la respuesta se corta en 1000 filas (max_rows) y el CSV del
    // período salía incompleto sin avisar.
    const supabase = createClient();
    const { data, error } = await fetchAll((from, to) =>
      supabase
        .rpc('admin_finance_detail', { p_from: desde, p_to: hasta })
        .order('completado', { ascending: false })
        .order('folio')
        .range(from, to)
    );
    setBajando(false);

    if (error) {
      toast.error(`No se pudo exportar: ${error.message}`);
      return;
    }
    const filas = (data ?? []) as Fila[];
    if (filas.length === 0) {
      toast.info('No hay servicios completados en el periodo.');
      return;
    }

    // Aseguradoras en pausa (00153): el archivo sale sin sus columnas.
    const cabeceras = insurers
      ? ['Folio', 'Completado', 'Servicio', 'Usuario', 'Socio operador', 'Proveedor', 'Aseguradora', 'Bruto', 'Cubre la aseguradora', 'Paga el Usuario']
      : ['Folio', 'Completado', 'Servicio', 'Usuario', 'Socio operador', 'Proveedor', 'Bruto', 'Paga el Usuario'];
    // toCsv escapa comillas/comas y neutraliza fórmulas (los nombres los
    // escriben los Usuarios y socios).
    const csv = toCsv([
      cabeceras,
      ...filas.map((f) => [
        f.folio ?? '',
        new Date(f.completado).toISOString(),
        f.servicio,
        f.cliente ?? '',
        f.operador ?? '',
        f.proveedor ?? '',
        ...(insurers ? [f.aseguradora ?? 'Particular', f.bruto, f.cubierto, f.copago] : [f.bruto, f.copago]),
      ]),
    ]);

    // El BOM es lo que hace que Excel en español abra el archivo en UTF-8 y no
    // parta los acentos.
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `finanzas_${desde}_a_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={exportar}
      disabled={bajando}
      className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <Download className="h-4 w-4" />
      {bajando ? 'Generando…' : 'Exportar detalle'}
    </button>
  );
}
