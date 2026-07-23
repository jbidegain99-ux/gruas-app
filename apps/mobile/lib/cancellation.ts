// Política de cancelación (lado usuario). El mensaje varía según el estado:
// una vez que el operador fue despachado, cancelar puede tener consecuencias.
export function cancellationPolicyMessage(status: string): string {
  if (status === 'assigned' || status === 'en_route') {
    return 'El operador ya fue despachado hacia tu ubicación. Cancelar ahora puede generar un cargo por el desplazamiento. ¿Deseas continuar?';
  }
  return '¿Estás seguro que deseas cancelar esta solicitud?';
}

// true si la cancelación ocurre después del despacho (para resaltar el aviso).
export function isLateCancellation(status: string): boolean {
  return status === 'assigned' || status === 'en_route';
}
