import { describe, expect, it } from 'vitest';
import { buildXlsx, columnName, crc32, zipStored } from './xlsx';
import { tableRows, toCsv } from './table-export';

const dec = new TextDecoder();

describe('xlsx', () => {
  it('CRC-32 conocido', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('nombres de columna de Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('el ZIP tiene cabeceras, directorio central y fin en su lugar', () => {
    const z = zipStored([{ name: 'a.txt', data: new TextEncoder().encode('hola') }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const endAt = z.length - 22;
    expect(v.getUint32(endAt, true)).toBe(0x06054b50);
    expect(v.getUint16(endAt + 10, true)).toBe(1);
    const centralAt = v.getUint32(endAt + 16, true);
    expect(v.getUint32(centralAt, true)).toBe(0x02014b50);
    expect(dec.decode(z.slice(30 + 5, 30 + 5 + 4))).toBe('hola');
  });

  it('la hoja lleva textos escapados, números como número y las partes del libro', () => {
    const x = dec.decode(buildXlsx([['Folio', 'Monto'], ['BUDI-000001 <&>', 61.5], [null, 'x"y']], 'Casos'));
    expect(x).toContain('[Content_Types].xml');
    expect(x).toContain('xl/workbook.xml');
    expect(x).toContain('<sheet name="Casos"');
    expect(x).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">BUDI-000001 &lt;&amp;&gt;</t></is></c>');
    expect(x).toContain('<c r="B2"><v>61.5</v></c>');
    expect(x).toContain('x&quot;y');
    expect(x).not.toContain('r="A3"'); // celda vacía no se escribe
  });
});

describe('csv', () => {
  it('comillas, comas y fórmulas', () => {
    const rows = tableRows([{ a: 'San Salvador, Centro', b: '=HYPERLINK("x")', n: 5 }], [
      { header: 'Lugar', value: (r) => r.a },
      { header: 'Nota', value: (r) => r.b },
      { header: 'Km', value: (r) => r.n },
    ]);
    expect(toCsv(rows)).toBe('Lugar,Nota,Km\r\n"San Salvador, Centro","\'=HYPERLINK(""x"")",5');
  });
});
