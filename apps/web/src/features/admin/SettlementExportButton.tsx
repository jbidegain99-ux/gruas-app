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
  destinatario: string;
  operador: string;
  comision_pct: number;
  bruto: number;
  comision: number;
  a_pagar: number;
  efectivo: number;
  saldo: number;
};

/**
 * Exporta la liquidacion del periodo, una linea por servicio.
 *
 * Es el papel con el que se paga: sale de `admin_settlement_detail`, la misma
 * funcion detras de los totales de la pantalla, asi que el archivo no puede
 * discrepar de lo que se vio antes de transferir.
 */
export function SettlementExportButton({ desde, hasta }: { desde: string; hasta: string }) {
  const [bajando, setBajando] = useState(false);
  const toast = useToast();

  const exportar = async () => {
    setBajando(true);
    // Por tandas: la respuesta se corta en 1000 filas (max_rows) y el CSV de
    // la liquidación salía incompleto sin avisar.
    const supabase = createClient();
    const { data, error } = await fetchAll((from, to) =>
      supabase
        .rpc('admin_settlement_detail', { p_from: desde, p_to: hasta })
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

    const cabeceras = ['Folio', 'Completado', 'Servicio', 'Se le paga a', 'Socio operador', 'Comisión %', 'Bruto', 'Comisión', 'A pagar', 'Cobró en efectivo', 'Saldo'];
    // toCsv escapa y neutraliza fórmulas; un saldo negativo sigue siendo número.
    const csv = toCsv([
      cabeceras,
      ...filas.map((f) => [
        f.folio ?? '', new Date(f.completado).toISOString(), f.servicio,
        f.destinatario, f.operador, f.comision_pct, f.bruto, f.comision, f.a_pagar, f.efectivo, f.saldo,
      ]),
    ]);

    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `liquidacion_${desde}_a_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={exportar}
      disabled={bajando}
      className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <Download className="h-3.5 w-3.5" />
      {bajando ? 'Generando…' : 'Exportar liquidación'}
    </button>
  );
}
