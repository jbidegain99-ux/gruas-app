import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * ¿Este pedido lo cubre un programa MOPT? (migr. 00098)
 *
 * El usuario no elige: la base decide con la misma regla que aplica al crear la
 * solicitud (mopt_payer_for) —sin un seguro que pague ESTE servicio (sin póliza,
 * plan que lo excluye o servicios agotados) y la recogida dentro de una zona
 * MOPT que lo cubre—. Esto solo lo anticipa en el resumen, para que la persona sepa
 * ANTES de confirmar que no va a pagar. Si falla, deja `null` y la pantalla
 * sigue como un pedido particular; el veredicto real llega al crear.
 */
// `capped` (00151): la zona lo cubriría, pero el programa ya llegó a su tope
// del mes y el contrato corta la cortesía; la pantalla lo explica.
export type MoptProgram = { applies: boolean; program_name?: string; capped?: boolean };

export function useMoptProgram(params: {
  enabled: boolean;
  lat: number | null | undefined;
  lng: number | null | undefined;
  serviceType: string;
}) {
  const { enabled, lat, lng, serviceType } = params;
  const [mopt, setMopt] = useState<MoptProgram | null>(null);

  useEffect(() => {
    if (!enabled || lat == null || lng == null) {
      setMopt(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('preview_mopt_program', {
          p_lat: lat,
          p_lng: lng,
          p_service_type: serviceType,
        });
        if (!alive) return;
        if (error) {
          console.error('[mopt/preview] fallo:', JSON.stringify(error));
          setMopt(null);
        } else {
          setMopt((data as MoptProgram) ?? null);
        }
      } catch (e) {
        if (alive) {
          console.error('[mopt/preview] error de conexion:', e);
          setMopt(null);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, lat, lng, serviceType]);

  return { mopt };
}
