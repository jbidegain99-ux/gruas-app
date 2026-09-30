'use client';

/**
 * Lado cliente de los interruptores de la plataforma (ver platform-features.ts).
 *
 * - Dentro del panel, el layout (server) ya leyó el interruptor y lo pasa por
 *   <PlatformFeaturesProvider>: sin parpadeo y un router.refresh() lo relee.
 * - Fuera de un provider, la primera pantalla que lo pide dispara la RPC una
 *   sola vez por carga de página (caché de módulo). Mientras carga, y si falla,
 *   vale APAGADO.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/shared/lib/supabase/client';
import { FEATURES_OFF, getPlatformFeatures, type PlatformFeatures } from './platform-features';

const PlatformFeaturesContext = createContext<PlatformFeatures | null>(null);

export function PlatformFeaturesProvider({ value, children }: { value: PlatformFeatures; children: React.ReactNode }) {
  return <PlatformFeaturesContext.Provider value={value}>{children}</PlatformFeaturesContext.Provider>;
}

let cached: Promise<PlatformFeatures> | null = null;

/** Olvida la caché (p. ej. después de mover el interruptor). */
export function invalidatePlatformFeatures() {
  cached = null;
}

export function usePlatformFeatures(): PlatformFeatures {
  const fromProvider = useContext(PlatformFeaturesContext);
  const [fetched, setFetched] = useState<PlatformFeatures>(FEATURES_OFF);

  useEffect(() => {
    if (fromProvider) return;
    let alive = true;
    cached ??= getPlatformFeatures(createClient());
    cached.then((f) => alive && setFetched(f));
    return () => {
      alive = false;
    };
  }, [fromProvider]);

  return fromProvider ?? fetched;
}

/** Atajo: ¿se muestran las aseguradoras (y reaseguradoras)? */
export function useInsurersEnabled(): boolean {
  return usePlatformFeatures().insurers;
}
