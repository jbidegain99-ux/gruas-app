// Checklist de alta de un cliente institucional (migr. 00130, VEN-03).
// Tipos y textos aparte de las páginas para probarlos sin montar React.

export type OrgType = 'INSURER' | 'MOPT' | 'REINSURER';

export type OnboardingStep =
  | { key: 'org'; done: boolean; detail: string }
  | {
      key: 'contract';
      done: boolean;
      contract: { reference: string; valid_from: string; valid_to: string | null; monthly_cap: number | null } | null;
      // Tarifa de Budi en porcentaje (5 = 5 %), tal como la guarda rate_versions.
      fee: number | null;
      fee_set: boolean;
      sla_assignment_minutes: number;
      sla_arrival_minutes: number;
    }
  | {
      key: 'owner';
      done: boolean;
      owner: { name: string | null; email: string; since: string } | null;
      invitations: { id: string; email: string; role: string; created_at: string; expires_at: string; expired: boolean }[];
    }
  | { key: 'members'; done: boolean; plans: number; rules: number; policies: number; members: number }
  | { key: 'zones'; done: boolean; zones: number }
  | { key: 'cedents'; done: boolean; links: number; granted: number }
  | {
      key: 'test';
      done: boolean;
      passed_at: string | null;
      last_input: Record<string, unknown> | null;
      last_result: PreviewResult | null;
    };

export type PreviewResult = {
  ok: boolean;
  reason: string | null;
  member?: string;
  policy_number?: string;
  plan?: string;
  amount_total?: number;
  amount_covered?: number;
  amount_copay?: number;
  events_used?: number;
  services_per_year?: number;
  zones?: { zone: string; is_active: boolean; serves: boolean; open_now: boolean }[];
};

export type OnboardingStatus = {
  organization: { id: string; type: OrgType; name: string; status: string; insurer_id: string | null; provider_id: string | null };
  started_at: string;
  completed_at: string | null;
  hours: number;
  notes: string | null;
  steps: OnboardingStep[];
  ready: boolean;
};

export const ORG_TYPE_LABEL: Record<OrgType, string> = { INSURER: 'Aseguradora', MOPT: 'Programa MOPT', REINSURER: 'Reaseguradora' };

export function stepTitle(key: OnboardingStep['key'], type: OrgType): string {
  switch (key) {
    case 'org':
      return 'Organización creada';
    case 'contract':
      return type === 'MOPT' ? 'Contrato y tarifa de Budi' : 'Contrato y SLA';
    case 'owner':
      return 'Dueño del portal';
    case 'members':
      return 'Planes, póliza y afiliados';
    case 'zones':
      return 'Zonas de elegibilidad';
    case 'test':
      return 'Caso de prueba';
    case 'cedents':
      return 'Aseguradoras cedentes autorizadas';
  }
}

/** Página del admin donde se completa el paso (cuando no se hace en el checklist). */
export function stepLink(key: OnboardingStep['key'], org: OnboardingStatus['organization']): string | null {
  if (org.type === 'INSURER' && org.insurer_id && (key === 'org' || key === 'members' || key === 'contract'))
    return `/admin/insurers/${org.insurer_id}`;
  if (org.type === 'MOPT' && (key === 'org' || key === 'zones' || key === 'contract')) return '/admin/mopt';
  if (org.type === 'REINSURER' && (key === 'org' || key === 'cedents')) return '/admin/reaseguradoras';
  return null;
}

/** "3 h", "1 día 2 h". El objetivo del backlog es ≤ 1 día. */
export function elapsedLabel(hours: number): string {
  if (hours < 1) return 'menos de 1 h';
  const h = Math.round(hours);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  const rest = h % 24;
  return `${d} ${d === 1 ? 'día' : 'días'}${rest ? ` ${rest} h` : ''}`;
}
