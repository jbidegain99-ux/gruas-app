import { describe, it, expect } from 'vitest';
import { parseCsv, mapearAfiliados } from './csv';

describe('parseCsv', () => {
  it('separa por comas', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('acepta ; como separador (Excel en locales con coma decimal)', () => {
    expect(parseCsv('a;b;c')).toEqual([['a', 'b', 'c']]);
  });

  it('respeta comas dentro de comillas', () => {
    expect(parseCsv('"Perez, Juan",123')).toEqual([['Perez, Juan', '123']]);
  });

  it('desescapa "" como comilla literal', () => {
    expect(parseCsv('"dice ""hola""",x')).toEqual([['dice "hola"', 'x']]);
  });

  it('divide filas por \\n y tolera CRLF', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('quita el BOM del inicio', () => {
    // Sin quitarlo, la primera cabecera no casaría con su alias.
    const filas = parseCsv('﻿dui,nombre\n01-2,Ana');
    expect(filas[0]).toEqual(['dui', 'nombre']);
  });

  it('descarta filas totalmente vacías', () => {
    expect(parseCsv('a,b\n\n,\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('cierra la última celda sin salto de línea final', () => {
    expect(parseCsv('a,b')).toEqual([['a', 'b']]);
  });
});

describe('mapearAfiliados', () => {
  it('reconoce cabeceras en español y en cualquier orden', () => {
    const { members, faltantes } = mapearAfiliados([
      ['Nombre', 'DUI'],
      ['Ana Uno', '01234567-8'],
    ]);
    expect(faltantes).toEqual([]);
    expect(members).toEqual([{ document_number: '01234567-8', full_name: 'Ana Uno' }]);
  });

  it('reconoce cabeceras en inglés', () => {
    const { members } = mapearAfiliados([
      ['document_number', 'full_name'],
      ['02345678-9', 'Bob'],
    ]);
    expect(members[0]).toEqual({ document_number: '02345678-9', full_name: 'Bob' });
  });

  it('reporta las columnas obligatorias que faltan', () => {
    const { faltantes } = mapearAfiliados([['telefono'], ['7000-0000']]);
    expect(faltantes).toContain('documento / DUI');
    expect(faltantes).toContain('nombre');
  });

  it('lista las columnas que no reconoce (y las ignora)', () => {
    const { members, columnasIgnoradas } = mapearAfiliados([
      ['dui', 'nombre', 'color favorito'],
      ['01-2', 'Ana', 'azul'],
    ]);
    expect(columnasIgnoradas).toEqual(['color favorito']);
    expect(members[0]).not.toHaveProperty('color favorito');
  });

  it('omite los campos opcionales vacíos en vez de mandarlos como ""', () => {
    const { members } = mapearAfiliados([
      ['dui', 'nombre', 'telefono'],
      ['01-2', 'Ana', ''],
    ]);
    expect(members[0]).not.toHaveProperty('phone');
  });

  it('traduce la relación a holder/beneficiary', () => {
    const { members } = mapearAfiliados([
      ['dui', 'nombre', 'parentesco'],
      ['01-2', 'Ana', 'Titular'],
      ['03-4', 'Bob', 'beneficiario'],
    ]);
    expect(members[0].relationship).toBe('holder');
    expect(members[1].relationship).toBe('beneficiary');
  });

  it('normaliza fechas dd/mm/aaaa a ISO (sin confundir mes y día)', () => {
    const { members } = mapearAfiliados([
      ['dui', 'nombre', 'alta'],
      ['01-2', 'Ana', '03/04/2026'],
    ]);
    // 3 de abril, no 4 de marzo.
    expect(members[0].starts_on).toBe('2026-04-03');
  });

  it('devuelve faltantes sin reventar con entrada vacía', () => {
    expect(mapearAfiliados([])).toEqual({
      members: [],
      columnasIgnoradas: [],
      faltantes: ['document_number', 'full_name'],
    });
  });
});
