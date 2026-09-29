// Etiquetas y formato de la bitácora (migr. 00094). Separado de la página para
// poder probarlo sin montar React.

export type AuditChanges = Record<string, { old: unknown; new: unknown }>;

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  INSERT: 'Alta',
  UPDATE: 'Cambio',
  DELETE: 'Baja',
};

const TABLE_LABELS: Record<string, string> = {
  profiles: 'Usuarios',
  providers: 'Proveedores',
  provider_commissions: 'Comisión de proveedor',
  provider_services: 'Servicios de proveedor',
  services: 'Catálogo de servicios',
  pricing_rules: 'Tarifas',
  insurers: 'Aseguradoras',
  insurer_api_keys: 'Llaves de API',
  coverage_plans: 'Planes de cobertura',
  coverage_rules: 'Reglas de cobertura',
  policies: 'Pólizas',
  mopt_zones: 'Zonas MOPT',
  ledger_payments: 'Pagos',
  rate_versions: 'Comisiones (versiones)',
  app_release_policy: 'Versión de la app',
  mfa_factors: 'Verificación en dos pasos (2FA)',
};

const COLUMN_LABELS: Record<string, string> = {
  role: 'Rol',
  provider_id: 'Empresa',
  insurer_id: 'Aseguradora',
  verification_status: 'Verificación',
  verification_rejection_reason: 'Motivo de rechazo',
  commission_rate: 'Comisión (%)',
  kind: 'Tipo de tarifa',
  subject_id: 'Aplica a',
  rate: 'Tasa (%)',
  valid_from: 'Vigente desde',
  name: 'Nombre',
  min_version: 'Versión mínima',
  latest_version: 'Última versión',
  store_url: 'Enlace a la tienda',
  '2fa_restablecido': 'Factores 2FA',
  motivo: 'Motivo',
  name_es: 'Nombre',
  name_en: 'Nombre (inglés)',
  is_active: 'Activo',
  is_available: 'Disponible',
  base_price: 'Precio base',
  custom_price: 'Precio propio',
  extra_fee: 'Recargo',
  base_exit_fee: 'Banderazo',
  included_km: 'Km incluidos',
  price_per_km_light: 'Precio/km liviana',
  price_per_km_heavy: 'Precio/km pesada',
  contact_email: 'Email de contacto',
  contact_phone: 'Teléfono de contacto',
  contact_name: 'Contacto',
  sla_assignment_minutes: 'SLA asignación (min)',
  sla_arrival_minutes: 'SLA llegada (min)',
  policy_number: 'Número de póliza',
  status: 'Estado',
  starts_on: 'Inicio',
  ends_on: 'Fin',
  rule_key: 'Regla',
  rule_value: 'Valor',
  service_type: 'Tipo de servicio',
  revoked_at: 'Revocada',
  is_mopt: 'Programa MOPT',
  polygon: 'Polígono',
  service_types: 'Servicios cubiertos',
  amount: 'Monto',
  paid_on: 'Fecha de pago',
  reference: 'Referencia',
  note: 'Nota',
  payer_kind: 'Paga',
  payee_kind: 'Recibe',
  voided_at: 'Anulado',
  void_reason: 'Motivo de anulación',
};

const ROLE_LABELS: Record<string, string> = {
  USER: 'Usuario',
  OPERATOR: 'Socio operador',
  ADMIN: 'Administrador',
  INSURER: 'Aseguradora',
  MOPT: 'Programa MOPT',
  SUPPORT: 'Soporte',
};

const VERIFICATION_LABELS: Record<string, string> = {
  pending: 'En revisión',
  approved: 'Aprobado',
  rejected: 'Rechazado',
};

export function auditRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function auditTableLabel(table: string): string {
  return TABLE_LABELS[table] ?? table;
}

export function auditColumnLabel(column: string): string {
  return COLUMN_LABELS[column] ?? column;
}

/** Valor de un campo para mostrar en el diff. "Sin valor" nunca se pinta como 0. */
export function formatAuditValue(value: unknown, column?: string): string {
  if (value === null || value === undefined) return '—';
  if (column === 'role' && typeof value === 'string') return auditRoleLabel(value);
  if (column === 'verification_status' && typeof value === 'string') {
    return VERIFICATION_LABELS[value] ?? value;
  }
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
