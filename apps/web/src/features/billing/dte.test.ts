import { describe, expect, it } from 'vitest';
import {
  buildDte, enteroEnLetras, fechaHoraSV, missingFields, normalizeDireccion, numeroControl, parseMhDate, round2,
  totalEnLetras, type Emisor, type Receptor,
} from './dte';
import { statementItems } from './statement-dte';
import type { StatementDetail } from '@/features/statements/statement-types';

type Doc = {
  identificacion: Record<string, unknown>;
  cuerpoDocumento: Record<string, unknown>[];
  resumen: Record<string, unknown> & { tributos: unknown[] };
  receptor: { direccion: Record<string, string> };
};
type Lines = StatementDetail['lines'];

const emisor: Emisor = {
  nit: '06142803901121', nrc: '1234567', nombre: 'Budi, S.A. de C.V.', codActividad: '52219',
  descActividad: 'Otras actividades de servicio de apoyo al transporte', nombreComercial: 'Budi', tipoEstablecimiento: '02',
  direccion: { departamento: '6', municipio: '14', complemento: 'Col. Escalón,\n San Salvador' },
  telefono: '22220000', correo: 'facturas@budi.invalid', codEstableMH: null, codPuntoVentaMH: null,
};
const receptor: Receptor = {
  nombre: 'Seguros Demo, S.A. de C.V.', nit: '06140101001234', nrc: '7654321', codActividad: '65110',
  descActividad: 'Seguros de vida', direccion: { departamento: '06', municipio: '14', complemento: 'Paseo General Escalón' },
  correo: 'cxp@segurosdemo.invalid',
};
const base = {
  ambiente: '00' as const, codEstable: 'M001', codPuntoVenta: 'P001', correlativo: 0,
  codigoGeneracion: '0a1b2c3d-0000-4000-8000-000000000001', fecha: new Date('2026-09-30T02:30:00Z'),
  condicionOperacion: 2 as const,
};

describe('DTE: utilidades', () => {
  it('redondea a 2 decimales sin el error de coma flotante', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('arma el número de control con 15 dígitos', () => {
    expect(numeroControl('03', 'm001', 'p001', 42)).toBe('DTE-03-M001P001-000000000000042');
  });

  it('fecha y hora de emisión en hora de El Salvador', () => {
    expect(fechaHoraSV(new Date('2026-09-30T02:30:00Z'))).toEqual({ fecEmi: '2026-09-29', horEmi: '20:30:00' });
  });

  it('lee la fecha que devuelve el MH (dd/MM/yyyy HH:mm:ss, UTC-6)', () => {
    expect(parseMhDate('29/09/2026 20:30:00')?.toISOString()).toBe('2026-09-30T02:30:00.000Z');
    expect(parseMhDate('2026-09-29')).toBeNull();
  });

  it('normaliza la dirección (códigos de 2 dígitos, complemento en una línea)', () => {
    expect(normalizeDireccion(emisor.direccion)).toEqual({ departamento: '06', municipio: '14', complemento: 'Col. Escalón, San Salvador' });
    expect(normalizeDireccion({ departamento: 'SS', municipio: '1', complemento: 'x' })).toBeNull();
  });

  it('escribe el total en letras', () => {
    expect(enteroEnLetras(123)).toBe('CIENTO VEINTITRÉS');
    expect(enteroEnLetras(1_021_100)).toBe('UN MILLÓN VEINTIÚN MIL CIEN');
    expect(enteroEnLetras(31_000)).toBe('TREINTA Y UN MIL');
    expect(totalEnLetras(100)).toBe('CIEN 00/100 DÓLARES');
    expect(totalEnLetras(2045.5)).toBe('DOS MIL CUARENTA Y CINCO 50/100 DÓLARES');
  });
});

describe('DTE: documentos', () => {
  it('Crédito fiscal con precios que ya traen IVA: base sin IVA por ítem e IVA 13 % en el resumen', () => {
    const d = buildDte(emisor, receptor, [
      { descripcion: 'Asistencia vial · A', cantidad: 1, precio: 113 },
      { descripcion: 'Asistencia vial · B', cantidad: 1, precio: 56.5 },
    ], { ...base, tipo: '03', preciosIncluyenIva: true }) as unknown as Doc;
    expect(d.identificacion).toMatchObject({ version: 3, tipoDte: '03', numeroControl: 'DTE-03-M001P001-000000000000000', fecEmi: '2026-09-29' });
    expect(d.cuerpoDocumento.map((i) => i.ventaGravada)).toEqual([100, 50]);
    expect(d.cuerpoDocumento[0].tributos).toEqual(['20']);
    expect(d.resumen).toMatchObject({ totalGravada: 150, subTotal: 150, montoTotalOperacion: 169.5, totalPagar: 169.5 });
    expect(d.resumen.tributos[0]).toEqual({ codigo: '20', descripcion: 'Impuesto al Valor Agregado 13%', valor: 19.5 });
    expect(d.resumen.totalLetras).toBe('CIENTO SESENTA Y NUEVE 50/100 DÓLARES');
    expect(d.receptor.direccion.departamento).toBe('06');
  });

  it('Crédito fiscal: con precios que traen IVA, el total cuadra al centavo con lo aprobado', () => {
    const precios = [113.5, 56.25, 80.33, 12.7, 45.99, 67.12, 99.99, 33.33, 58.01, 61, 61, 57.9];
    const d = buildDte(emisor, receptor, precios.map((precio, i) => ({ descripcion: `L${i}`, cantidad: 1, precio })),
      { ...base, tipo: '03', preciosIncluyenIva: true }) as unknown as Doc;
    const suma = round2(precios.reduce((a, b) => a + b, 0));
    expect(d.resumen.totalPagar).toBe(suma);
    const bases = round2(d.cuerpoDocumento.reduce((a, i) => a + Number(i.ventaGravada), 0));
    expect(bases).toBe(d.resumen.totalGravada);
  });

  it('Factura: precio con IVA por ítem y su ivaItem; el total cuadra con la suma de líneas', () => {
    const d = buildDte(emisor, { nombre: 'Programa MOPT' }, [
      { descripcion: 'Tarifa · A', cantidad: 1, precio: 3.05 },
      { descripcion: 'Tarifa · B', cantidad: 1, precio: 3.05 },
      { descripcion: 'Tarifa · C', cantidad: 1, precio: 3.05 },
    ], { ...base, tipo: '01', preciosIncluyenIva: true }) as unknown as Doc;
    expect(d.identificacion.version).toBe(1);
    expect(d.cuerpoDocumento[0]).toMatchObject({ precioUni: 3.05, ventaGravada: 3.05, ivaItem: 0.35, tributos: null });
    expect(d.resumen.totalGravada).toBe(9.15);
    expect(d.resumen.totalIva).toBe(1.05);
    expect(d.resumen.totalPagar).toBe(9.15);
  });

  it('señala lo que falta antes de emitir un crédito fiscal', () => {
    expect(missingFields('03', emisor, receptor)).toEqual([]);
    expect(missingFields('03', { ...emisor, nrc: '' }, { nombre: 'X' })).toEqual([
      'Emisor: NRC', 'Receptor: NIT', 'Receptor: NRC', 'Receptor: actividad económica', 'Receptor: dirección', 'Receptor: correo',
    ]);
    expect(missingFields('01', emisor, { nombre: 'X' })).toEqual([]);
  });
});

describe('DTE: desde el estado de cuenta', () => {
  const line = (over: object) => ({
    request_id: 'r', folio: 'BUDI-000001', completed_at: '2026-09-10T18:00:00Z', service_type: 'tow', provider_name: null,
    tow_km: null, total_km: null, amount: 61, fee: 3.05, copay: null, observation: null, ...over,
  });

  it('al MOPT solo se le factura la tarifa de plataforma', () => {
    const items = statementItems({ organization: { id: 'o', name: 'MOPT', type: 'MOPT' }, lines: [line({}), line({ fee: 0 })] as unknown as Lines });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ precio: 3.05, codigo: 'BUDI-000001' });
    expect(items[0].descripcion).toBe('Tarifa de plataforma Budi · Grúa · BUDI-000001 · 10/09/2026');
  });

  it('a la aseguradora, lo cubierto con los ajustes aceptados', () => {
    const items = statementItems({
      organization: { id: 'o', name: 'Seguros', type: 'INSURER' },
      lines: [
        line({ amount: 80, fee: 0 }),
        line({ amount: 50, fee: 0, observation: { id: 'x', status: 'adjusted', adjusted_amount: 40, events: [] } }),
        line({ amount: 30, fee: 0, observation: { id: 'y', status: 'open', adjusted_amount: null, events: [] } }),
      ] as unknown as Lines,
    });
    expect(items.map((i) => i.precio)).toEqual([80, 40, 30]);
  });
});
