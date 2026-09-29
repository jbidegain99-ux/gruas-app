import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Quién paga cada servicio, para el socio operador (backlog LAN-06, migr. 00108).
 *
 * El socio tiene que saber ANTES de aceptar que no debe cobrarle al Usuario:
 * cortesía MOPT o cubierto por una aseguradora. Sin montos del Usuario. La base
 * solo responde por servicios que ese socio ya puede ver.
 */
export type PayerInfo = { payer: 'mopt' | 'insurer' | 'user'; label: string | null; has_copay: boolean };

export function usePayerInfo(requestIds: string[]): Record<string, PayerInfo> {
  const [info, setInfo] = useState<Record<string, PayerInfo>>({});
  const key = requestIds.slice().sort().join(',');

  useEffect(() => {
    if (!key) {
      setInfo({});
      return;
    }
    let alive = true;
    supabase
      .rpc('service_payer_info', { p_request_ids: key.split(',') })
      .then(({ data }) => {
        if (!alive || !data) return;
        const map: Record<string, PayerInfo> = {};
        for (const row of data as ({ request_id: string } & PayerInfo)[]) {
          map[row.request_id] = { payer: row.payer, label: row.label, has_copay: row.has_copay };
        }
        setInfo(map);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return info;
}
