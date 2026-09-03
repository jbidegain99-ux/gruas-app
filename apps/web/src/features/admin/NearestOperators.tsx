'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';

// B-16: candidatos de despacho, tal como los devuelve suggest_nearest_operators().
type Suggestion = {
  operator_id: string;
  full_name: string;
  provider_name: string | null;
  distance_km: number;
  last_seen: string;
};

/**
 * Sugiere al despachador los operadores más cercanos disponibles, con su
 * distancia, y deja asignar el elegido — en vez de asignar a ciegas al más
 * cercano. El primero (el más cercano) va marcado.
 */
export function NearestOperators({
  requestId,
  onAssigned,
}: {
  requestId: string;
  onAssigned: () => void;
}) {
  const [ops, setOps] = useState<Suggestion[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const toast = useToast();
  const loading = requestId !== loadedFor;

  useEffect(() => {
    let alive = true;
    createClient()
      .rpc('suggest_nearest_operators', { p_request_id: requestId, p_limit: 3 })
      .then(({ data }) => {
        if (!alive) return;
        setOps((data as Suggestion[]) ?? []);
        setLoadedFor(requestId);
      });
    return () => {
      alive = false;
    };
  }, [requestId]);

  const asignar = async (operatorId: string) => {
    setAssigning(operatorId);
    const { error } = await createClient().rpc('admin_assign_request', {
      p_request_id: requestId,
      p_operator_id: operatorId,
    });
    setAssigning(null);
    if (error) {
      toast.error('No se pudo asignar el operador.');
      return;
    }
    toast.success('Operador asignado.');
    onAssigned();
  };

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase text-zinc-500">
        <MapPin className="h-3.5 w-3.5" />
        Operadores cercanos
      </p>

      {loading ? (
        <p className="text-xs text-zinc-500">Buscando operadores en línea…</p>
      ) : ops.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-xs text-zinc-500 dark:border-zinc-700">
          No hay operadores en línea disponibles cerca. Podés asignar uno manualmente abajo.
        </p>
      ) : (
        <ul className="space-y-2">
          {ops.map((op, i) => (
            <li
              key={op.operator_id}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-white">
                  <span className="truncate">{op.full_name}</span>
                  {i === 0 && (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      Más cercano
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {op.provider_name ? `${op.provider_name} · ` : ''}
                  <span className="tabular-nums">{op.distance_km} km</span>
                </p>
              </div>
              <button
                onClick={() => asignar(op.operator_id)}
                disabled={assigning !== null}
                className="shrink-0 rounded-lg bg-budi-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-budi-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {assigning === op.operator_id ? 'Asignando…' : 'Asignar'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
