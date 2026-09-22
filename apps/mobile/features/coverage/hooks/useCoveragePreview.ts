import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * B-13 — copago estimado ANTES de confirmar.
 *
 * `useCoverage` (B-11) dice SI el usuario esta cubierto; esto dice CUANTO va a
 * pagar: llama a `preview_my_coverage()`, que aplica las reglas del plan (B-12)
 * sobre el precio estimado y devuelve cuanto asume la aseguradora y cuanto queda
 * de copago. Es una vista previa —el numero final sale de `complete_service_request`
 * con la distancia real— por eso el copago se muestra como aproximado.
 *
 * Solo tiene sentido con el usuario cubierto: por eso `enabled`. Si algo falla
 * NO rompe el flujo — deja el preview en null y la pantalla muestra el precio a
 * secas, igual que para un cliente particular.
 */
export type CopayPreview = {
  covered: boolean;
  amount_total: number;
  amount_covered: number;
  amount_copay: number;
  excess_km_charge?: number | null;
  capped?: boolean;
};

export function useCoveragePreview(params: {
  enabled: boolean;
  serviceType: string;
  total: number | null;
  km?: number | null;
  towType?: 'light' | 'heavy';
}) {
  const { enabled, serviceType, total, km, towType } = params;
  const [preview, setPreview] = useState<CopayPreview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || total == null || total <= 0) {
      setPreview(null);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('preview_my_coverage', {
          p_service_type: serviceType,
          p_total: total,
          p_km: km ?? null,
          p_tow_type: towType ?? 'light',
        });
        if (!alive) return;
        if (error) {
          console.error('[coverage/preview] fallo:', JSON.stringify(error));
          setPreview(null);
        } else {
          setPreview((data as CopayPreview) ?? null);
        }
      } catch (e) {
        if (alive) {
          console.error('[coverage/preview] error de conexion:', e);
          setPreview(null);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, serviceType, total, km, towType]);

  return { preview, loading };
}
