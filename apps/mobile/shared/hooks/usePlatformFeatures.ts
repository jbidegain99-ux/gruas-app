import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Interruptores de la plataforma (migr. 00153, RPC `platform_features`).
 *
 * Hoy uno solo: `insurers`. Con las aseguradoras apagadas la base ya no da
 * cobertura (check_member_coverage → 'none'); esto es para que la app tampoco
 * HABLE de seguros, pólizas ni copagos. No se borra nada: al prenderlo desde el
 * admin, todo vuelve a aparecer.
 *
 * Se lee una vez por sesión de la app (caché de módulo, compartida por todas las
 * pantallas) y se vuelve a pedir si pasaron más de 5 minutos. Mientras carga, o
 * si la consulta falla, cuenta como APAGADO: mostrar de más prometería una
 * cobertura que el servidor no va a dar.
 */
export type PlatformFeatures = { insurers: boolean };

const OFF: PlatformFeatures = { insurers: false };
const TTL_MS = 5 * 60 * 1000;

let cached: PlatformFeatures | null = null;
let fetchedAt = 0;
let inflight: Promise<PlatformFeatures> | null = null;

function parse(data: unknown): PlatformFeatures {
  const r = (data ?? {}) as Record<string, unknown>;
  return { insurers: r.insurers === true };
}

export function loadPlatformFeatures(force = false): Promise<PlatformFeatures> {
  if (!force && cached && Date.now() - fetchedAt < TTL_MS) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc('platform_features');
      if (error) {
        console.error('[platform_features] fallo:', JSON.stringify(error));
        return cached ?? OFF;
      }
      cached = parse(data);
      fetchedAt = Date.now();
      return cached;
    } catch (e) {
      console.error('[platform_features] error de conexion:', e);
      return cached ?? OFF;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function usePlatformFeatures(): PlatformFeatures & { loading: boolean } {
  const [features, setFeatures] = useState<PlatformFeatures | null>(cached);

  useEffect(() => {
    let alive = true;
    loadPlatformFeatures().then((f) => {
      if (alive) setFeatures(f);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { ...(features ?? OFF), loading: features == null };
}

/** Atajo: ¿se muestra lo de aseguradoras? (apagado mientras carga o si falla). */
export function useInsurersEnabled(): boolean {
  return usePlatformFeatures().insurers;
}
