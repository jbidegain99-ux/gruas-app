/**
 * La organización (cliente institucional) de quien inició sesión — migr. 00106,
 * backlog POR-01. El acceso a los portales lo da la MEMBRESÍA, no un rol de
 * perfil: una misma persona puede ser Usuario de la app y trabajar en el
 * portal de su aseguradora o del MOPT.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlatformFeatures } from './platform-features';

export type OrganizationType = 'MOPT' | 'INSURER' | 'REINSURER' | 'PROVIDER';

export type MyOrganization = {
  id: string;
  type: OrganizationType;
  name: string;
  member_role: 'owner' | 'admin' | 'analyst' | 'viewer';
  /** 00113 (POR-02): dueño y administradores necesitan 2FA para ver datos. */
  mfa_required: boolean;
  /** La sesión actual ya pasó el segundo factor (o no lo necesita). */
  mfa_ok: boolean;
};

/** A dónde mandar a quien le falta el 2FA, para volver después a `next`. */
export function securityUrl(next: string): string {
  return `/seguridad?next=${encodeURIComponent(next)}`;
}

/** El portal de cada tipo de organización (los que todavía no tienen, null). */
export const PORTAL_BY_ORG_TYPE: Record<OrganizationType, string | null> = {
  MOPT: '/mopt',
  INSURER: '/portal',
  // REA-02 (00131).
  REINSURER: '/reaseguro',
  PROVIDER: null,
};

/**
 * El portal al que va alguien de ese tipo de organización HOY: con las
 * aseguradoras en pausa (migr. 00153), aseguradora y reaseguradora no tienen.
 */
export function portalFor(type: OrganizationType, features: PlatformFeatures): string | null {
  if ((type === 'INSURER' || type === 'REINSURER') && !features.insurers) return null;
  return PORTAL_BY_ORG_TYPE[type];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getMyOrganization(supabase: SupabaseClient<any>): Promise<MyOrganization | null> {
  // Un reintento ante error: justo después de iniciar sesión, una falla pasajera
  // (sesión recién escrita, servidor compilando) mandaba a un miembro del MOPT a
  // la página de la app móvil. "Sin organización" (data null) no se reintenta.
  for (let intento = 0; intento < 2; intento++) {
    const { data, error } = await supabase.rpc('my_organization');
    if (!error) return (data as MyOrganization | null) ?? null;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}
