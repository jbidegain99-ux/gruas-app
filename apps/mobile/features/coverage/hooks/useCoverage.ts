import { useCallback, useEffect, useState } from 'react';
import type { CoverageResult } from '@gruas-app/shared';
import { supabase } from '@/lib/supabase';

/**
 * B-11 — cobertura del usuario autenticado, para mostrarla ANTES de solicitar.
 *
 * Es informativa: la verificacion que manda es la que hace el servidor dentro de
 * `create_service_request`. Esta existe para que la persona sepa como va a
 * quedar el servicio antes de confirmarlo, no despues.
 *
 * Punto central del ticket: si la consulta falla, el hook NO devuelve null ni se
 * queda callado — devuelve `status: 'error'` con el motivo, para que la UI lo
 * diga. Un banner ausente se lee como "no pasa nada", que es exactamente el
 * fallo silencioso que B-11 viene a eliminar.
 */
export function useCoverage() {
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('check_member_coverage');
      if (error) {
        console.error('[coverage] fallo la verificacion:', JSON.stringify(error));
        setCoverage({ status: 'error', reason: error.message });
      } else {
        setCoverage((data as CoverageResult) ?? { status: 'none' });
      }
    } catch (e) {
      // Sin red, timeout, etc. Mismo criterio: se reporta, no se oculta.
      console.error('[coverage] error de conexion:', e);
      setCoverage({ status: 'error', reason: 'No hay conexión con el servidor' });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { coverage, loading, refresh };
}
