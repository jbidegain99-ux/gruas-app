// Del estado de cuenta (00123) a los ítems del DTE. Qué se le factura a cada
// cliente sale del libro de movimientos (00099), no de una suposición:
//   * MOPT: el servicio se lo paga directo al socio operador (servicio mopt →
//     operador); a Budi solo le debe la TARIFA DE PLATAFORMA. Se factura eso.
//   * Aseguradora: le debe a Budi lo que cubre su póliza (cobertura aseguradora
//     → Budi), con los ajustes que Budi aceptó en las observaciones.
// A confirmar con el contador (LAN-09).
import { serviceTypeLabel } from '@/shared/components/ServiceTypeBadge';
import { effectiveAmount, effectiveFee, type StatementDetail } from '@/features/statements/statement-types';
import { round2, type DteItem } from './dte';

const dia = (iso: string) =>
  new Intl.DateTimeFormat('es-SV', { timeZone: 'America/El_Salvador', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));

export function statementItems(s: Pick<StatementDetail, 'organization' | 'lines'>): DteItem[] {
  const items: DteItem[] = [];
  for (const l of s.lines) {
    const ref = `${serviceTypeLabel(l.service_type)} · ${l.folio ?? 'sin folio'} · ${dia(l.completed_at)}`;
    if (s.organization.type === 'MOPT') {
      // Con el ajuste que Budi aceptó: la tarifa en proporción, igual que el libro.
      const fee = round2(effectiveFee(l) || 0);
      if (fee > 0) items.push({ descripcion: `Tarifa de plataforma Budi · ${ref}`, cantidad: 1, precio: fee, codigo: l.folio });
    } else {
      const amount = round2(effectiveAmount(l) || 0);
      if (amount > 0) items.push({ descripcion: `Asistencia vial · ${ref}`, cantidad: 1, precio: amount, codigo: l.folio });
    }
  }
  return items;
}

export const WHAT_IS_BILLED: Record<'MOPT' | 'INSURER', string> = {
  MOPT: 'Solo la tarifa de plataforma de Budi: el MOPT le paga el servicio directo al socio operador.',
  INSURER: 'Lo que cubre la póliza en cada caso, con los ajustes aceptados en las observaciones.',
};
