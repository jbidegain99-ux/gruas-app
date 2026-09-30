/**
 * Interruptores de la plataforma (migr. 00153). Hoy uno solo: `insurers`.
 *
 * Walter (2026-09-30): "ocultá lo de las aseguradoras por el momento, yo te
 * aviso cuando tenga que aparecer". La fuente de verdad es la base
 * (`platform_features()`), no una variable de entorno: el admin lo prende y
 * lo apaga desde /admin/app y la web y la app lo leen igual. Con el interruptor
 * apagado la base ya no da cobertura y cierra los portales; acá solo se ocultan
 * las pantallas. Todo lo "de aseguradoras" incluye a las reaseguradoras.
 *
 * Si la RPC falla, se asume APAGADO (mostrar de menos es el lado seguro).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type PlatformFeatures = {
  /** Aseguradoras y reaseguradoras: pólizas, afiliados, copago, portales. */
  insurers: boolean;
};

export type PlatformFeature = keyof PlatformFeatures;

export const FEATURES_OFF: PlatformFeatures = { insurers: false };

export function parsePlatformFeatures(data: unknown): PlatformFeatures {
  const d = (data ?? {}) as Partial<Record<PlatformFeature, unknown>>;
  return { insurers: d.insurers === true };
}

/** Para server components, layouts y el proxy. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPlatformFeatures(supabase: SupabaseClient<any>): Promise<PlatformFeatures> {
  try {
    const { data, error } = await supabase.rpc('platform_features');
    if (error) return FEATURES_OFF;
    return parsePlatformFeatures(data);
  } catch {
    return FEATURES_OFF;
  }
}

/** Solo ADMIN (la base lo exige). Devuelve el mensaje de error, o null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function setInsurersEnabled(supabase: SupabaseClient<any>, enabled: boolean): Promise<string | null> {
  const { error } = await supabase.rpc('admin_set_insurers_enabled', { p_enabled: enabled });
  return error?.message ?? null;
}
