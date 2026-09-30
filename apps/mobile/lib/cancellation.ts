// Política de cancelación (lado usuario). El mensaje varía según el estado:
// una vez que el operador fue despachado, cancelar puede tener consecuencias.
// Los servicios del MOPT son cortesía (paga el programa): no se menciona cargo.
export const MOPT_CANCELLATION_NOTE = 'Este servicio es cortesía del MOPT: cancelar no tiene costo para ti.';

export function cancellationPolicyMessage(status: string, paidByMopt = false): string {
  if (status === 'assigned' || status === 'en_route') {
    if (paidByMopt) {
      return `El socio operador ya fue despachado hacia tu ubicación. ${MOPT_CANCELLATION_NOTE} ¿Deseas continuar?`;
    }
    return 'El socio operador ya fue despachado hacia tu ubicación. Cancelar ahora puede generar un cargo por el desplazamiento. ¿Deseas continuar?';
  }
  return '¿Estás seguro que deseas cancelar esta solicitud?';
}

// Aviso corto del modal de cancelación (historial) cuando ya hubo despacho.
export function lateCancellationWarning(paidByMopt = false): string {
  return paidByMopt
    ? `El socio operador ya fue despachado. ${MOPT_CANCELLATION_NOTE}`
    : 'El socio operador ya fue despachado. Cancelar ahora puede generar un cargo por el desplazamiento.';
}

// true si la cancelación ocurre después del despacho (para resaltar el aviso).
export function isLateCancellation(status: string): boolean {
  return status === 'assigned' || status === 'en_route';
}
