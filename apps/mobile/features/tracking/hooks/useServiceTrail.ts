import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type TrailPoint = { lat: number; lng: number };

/**
 * Carga el recorrido real grabado de un servicio (tabla `service_location_trail`,
 * ver migración 00034). Pensado para el detalle del historial: se pasa el id
 * del servicio seleccionado y se dispara sólo cuando el modal está abierto.
 *
 * Devuelve `null` mientras no hay id o mientras carga; un array (posiblemente
 * vacío) cuando terminó. Con < 2 puntos el `MiniMap` cae a la línea recta.
 */
export function useServiceTrail(requestId: string | null | undefined): TrailPoint[] | null {
  const [trail, setTrail] = useState<TrailPoint[] | null>(null);

  useEffect(() => {
    if (!requestId) {
      setTrail(null);
      return;
    }

    let active = true;
    setTrail(null);

    (async () => {
      const { data, error } = await supabase
        .from('service_location_trail')
        .select('lat, lng')
        .eq('request_id', requestId)
        .order('recorded_at', { ascending: true });

      if (!active) return;
      if (error) {
        console.warn('[useServiceTrail] No se pudo cargar el recorrido:', error.message);
        setTrail([]);
        return;
      }
      setTrail((data as TrailPoint[]) ?? []);
    })();

    return () => {
      active = false;
    };
  }, [requestId]);

  return trail;
}
