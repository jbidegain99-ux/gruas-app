import { describe, it, expect } from 'vitest';
import {
  serviceTypeLabel,
  describeRule,
  sortRules,
  ruleWarnings,
} from './coverage-rules';

describe('serviceTypeLabel', () => {
  it('null es la regla general', () => {
    expect(serviceTypeLabel(null)).toBe('Todos los servicios');
  });

  it('un tipo conocido se traduce (no devuelve el slug crudo)', () => {
    const label = serviceTypeLabel('tow');
    expect(label).not.toBe('tow');
    expect(label.length).toBeGreaterThan(0);
  });

  it('un tipo desconocido cae al valor tal cual', () => {
    expect(serviceTypeLabel('zzz')).toBe('zzz');
  });
});

describe('describeRule', () => {
  it('covered describe incluido vs no cubierto', () => {
    expect(describeRule({ service_type: null, rule_key: 'covered', rule_value: 1 })).toContain(
      'incluido en el plan',
    );
    expect(describeRule({ service_type: null, rule_key: 'covered', rule_value: 0 })).toContain(
      'NO cubierto',
    );
  });

  it('services_per_year concuerda singular/plural', () => {
    expect(describeRule({ service_type: 'tow', rule_key: 'services_per_year', rule_value: 1 })).toContain(
      '1 evento al año',
    );
    expect(describeRule({ service_type: 'tow', rule_key: 'services_per_year', rule_value: 4 })).toContain(
      '4 eventos al año',
    );
  });

  it('max_covered_amount formatea el monto con dos decimales', () => {
    expect(
      describeRule({ service_type: 'tow', rule_key: 'max_covered_amount', rule_value: 150 }),
    ).toContain('$150.00');
  });

  it('included_km menciona el excedente al afiliado', () => {
    expect(describeRule({ service_type: 'tow', rule_key: 'included_km', rule_value: 25 })).toContain(
      '25 km incluidos',
    );
  });
});

describe('sortRules', () => {
  it('la regla general va primero; dentro de un tipo, covered antes que el resto', () => {
    const desordenadas = [
      { service_type: 'tow', rule_key: 'included_km' as const },
      { service_type: 'tow', rule_key: 'covered' as const },
      { service_type: null, rule_key: 'covered' as const },
    ];
    const ordenadas = sortRules(desordenadas);
    expect(ordenadas[0].service_type).toBeNull();
    expect(ordenadas[1]).toMatchObject({ service_type: 'tow', rule_key: 'covered' });
    expect(ordenadas[2]).toMatchObject({ service_type: 'tow', rule_key: 'included_km' });
  });

  it('no muta el arreglo de entrada', () => {
    const entrada = [
      { service_type: 'tow', rule_key: 'covered' as const },
      { service_type: null, rule_key: 'covered' as const },
    ];
    const copia = [...entrada];
    sortRules(entrada);
    expect(entrada).toEqual(copia);
  });
});

describe('ruleWarnings', () => {
  it('avisa cuando falta la regla general de "cubierto"', () => {
    const avisos = ruleWarnings([{ service_type: 'tow', rule_key: 'covered', rule_value: 1 }]);
    expect(avisos.some((a) => a.includes('regla general'))).toBe(true);
  });

  it('avisa de una regla sobre un servicio marcado como NO cubierto', () => {
    const avisos = ruleWarnings([
      { service_type: null, rule_key: 'covered', rule_value: 1 },
      { service_type: 'tow', rule_key: 'covered', rule_value: 0 },
      { service_type: 'tow', rule_key: 'included_km', rule_value: 25 },
    ]);
    expect(avisos.some((a) => a.includes('NO cubierto'))).toBe(true);
  });

  it('un plan bien formado no genera avisos', () => {
    const avisos = ruleWarnings([
      { service_type: null, rule_key: 'covered', rule_value: 1 },
      { service_type: 'tow', rule_key: 'covered', rule_value: 1 },
      { service_type: 'tow', rule_key: 'included_km', rule_value: 25 },
    ]);
    expect(avisos).toEqual([]);
  });
});
