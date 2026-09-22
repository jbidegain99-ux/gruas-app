'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';

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
export function FinanceExportButton({ desde, hasta }: { desde: string; hasta: string }) {
  const [bajando, setBajando] = useState(false);
  const toast = useToast();

  const exportar = async () => {
    setBajando(true);
    const { data, error } = await createClient().rpc('admin_finance_detail', {
      p_from: desde,
      p_to: hasta,
    });
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

    const cabeceras = [
      'Folio', 'Completado', 'Servicio', 'Cliente', 'Operador', 'Proveedor',
      'Aseguradora', 'Bruto', 'Cubre la aseguradora', 'Paga el cliente',
    ];
    // Escapa cada celda: comillas alrededor y comillas internas duplicadas, para
    // que un nombre con comas no corra las columnas.
    const celda = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      cabeceras,
      ...filas.map((f) => [
        f.folio ?? '',
        new Date(f.completado).toISOString(),
        f.servicio,
        f.cliente ?? '',
        f.operador ?? '',
        f.proveedor ?? '',
        f.aseguradora ?? 'Particular',
        f.bruto,
        f.cubierto,
        f.copago,
      ]),
    ]
      .map((r) => r.map(celda).join(','))
      .join('\n');

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
