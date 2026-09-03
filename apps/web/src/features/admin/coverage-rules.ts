// Utilidades para leer y escribir las reglas de cobertura (B-09).
//
// Las reglas viven como FILAS en `coverage_rules`, no como columnas — ver el
// encabezado de la migración 00044 y docs/ERD_COBERTURA.md. Eso las hace
// flexibles pero ilegibles en crudo: una tabla de `rule_key` / `rule_value` no
// le dice nada a quien administra. Este módulo traduce entre las dos vistas.

import { SERVICE_TYPE_CONFIGS } from '@gruas-app/shared';
import type { ServiceType } from '@gruas-app/shared';

export type RuleKey = 'covered' | 'services_per_year' | 'included_km' | 'max_covered_amount';

export type CoverageRule = {
  id: string;
  plan_id: string;
  /** null = la regla aplica a todos los tipos de servicio. */
  service_type: string | null;
  rule_key: RuleKey;
  rule_value: number | null;
};

/** Las cuatro claves que admite el CHECK de la tabla. */
export const RULE_KEYS: {
  key: RuleKey;
  label: string;
  /** Ayuda mostrada bajo el selector. */
  hint: string;
  /** `covered` es un si/no; el resto son cantidades. */
  boolean?: boolean;
  unit?: string;
}[] = [
  { key: 'covered', label: 'Cubierto', hint: '1 = incluido, 0 = excluido', boolean: true },
  { key: 'services_per_year', label: 'Eventos por año', hint: 'Tope de servicios al año. Sin regla = sin tope.', unit: 'al año' },
  { key: 'included_km', label: 'Km incluidos', hint: 'Km de arrastre cubiertos; el excedente va a copago.', unit: 'km' },
  { key: 'max_covered_amount', label: 'Tope por evento', hint: 'Máximo en USD que asume la aseguradora por evento.', unit: 'USD' },
];

export const SERVICE_TYPES = Object.keys(SERVICE_TYPE_CONFIGS) as ServiceType[];

/** Etiqueta de un tipo de servicio; `null` es la regla general. */
export function serviceTypeLabel(type: string | null): string {
  if (!type) return 'Todos los servicios';
  return SERVICE_TYPE_CONFIGS[type as ServiceType]?.name ?? type;
}

export function ruleKeyLabel(key: RuleKey): string {
  return RULE_KEYS.find((r) => r.key === key)?.label ?? key;
}

/**
 * Convierte una regla en una frase que se entienda sin conocer el esquema.
 * Es lo que hace usable la pantalla: el admin lee "Grúa: hasta 4 eventos al año"
 * en vez de `tow / services_per_year / 4`.
 */
export function describeRule(rule: Pick<CoverageRule, 'service_type' | 'rule_key' | 'rule_value'>): string {
  const donde = serviceTypeLabel(rule.service_type);
  const v = rule.rule_value;

  switch (rule.rule_key) {
    case 'covered':
      return v ? `${donde}: incluido en el plan` : `${donde}: NO cubierto`;
    case 'services_per_year':
      return `${donde}: hasta ${v ?? 0} evento${v === 1 ? '' : 's'} al año`;
    case 'included_km':
      return `${donde}: ${v ?? 0} km incluidos, el excedente se cobra al afiliado`;
    case 'max_covered_amount':
      return `${donde}: la aseguradora cubre hasta $${(v ?? 0).toFixed(2)} por evento`;
    default:
      return `${donde}: ${rule.rule_key} = ${v}`;
  }
}

/**
 * Ordena las reglas para leerlas: primero la general (`service_type` null),
 * luego cada tipo agrupado. Dentro de un tipo, `covered` primero porque decide
 * si el resto de reglas siquiera aplica.
 */
export function sortRules<T extends Pick<CoverageRule, 'service_type' | 'rule_key'>>(rules: T[]): T[] {
  const ordenClave = RULE_KEYS.map((r) => r.key);
  return [...rules].sort((a, b) => {
    if (a.service_type === null && b.service_type !== null) return -1;
    if (b.service_type === null && a.service_type !== null) return 1;
    const porTipo = (a.service_type ?? '').localeCompare(b.service_type ?? '');
    if (porTipo !== 0) return porTipo;
    return ordenClave.indexOf(a.rule_key) - ordenClave.indexOf(b.rule_key);
  });
}

/**
 * Avisos sobre combinaciones que el CHECK de la base no puede detectar pero que
 * casi siempre son un error de captura. No bloquean el guardado: el motor de
 * B-12 decidirá la semántica final, así que aquí solo se advierte.
 */
export function ruleWarnings(rules: Pick<CoverageRule, 'service_type' | 'rule_key' | 'rule_value'>[]): string[] {
  const avisos: string[] = [];
  const general = rules.find((r) => r.service_type === null && r.rule_key === 'covered');

  if (!general) {
    avisos.push(
      'No hay una regla general de "Cubierto". Sin ella no queda claro qué pasa con los servicios que no tienen regla propia.'
    );
  }

  for (const r of rules) {
    if (r.rule_key === 'covered') continue;
    const excluido = rules.find(
      (o) => o.service_type === r.service_type && o.rule_key === 'covered' && !o.rule_value
    );
    if (excluido) {
      avisos.push(
        `${serviceTypeLabel(r.service_type)}: tiene "${ruleKeyLabel(r.rule_key)}" pero el servicio está marcado como NO cubierto.`
      );
    }
  }

  const km = rules.find((r) => r.rule_key === 'included_km' && r.service_type !== 'tow' && r.service_type !== null);
  if (km) {
    avisos.push(
      `${serviceTypeLabel(km.service_type)}: "Km incluidos" solo tiene sentido en servicios que trasladan el vehículo.`
    );
  }

  return avisos;
}
