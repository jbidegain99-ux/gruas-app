// Lectura de CSV para la importación de padrones (B-10).
//
// Parser propio en vez de una dependencia: el formato que se necesita soportar
// es el que exporta Excel —comillas dobles, comas dentro del campo, `""` como
// comilla escapada, CRLF— y eso son treinta líneas. Añadir una librería por esto
// traería más superficie que valor.

/** Divide el texto en filas de celdas, respetando comillas. */
export function parseCsv(text: string): string[][] {
  // Excel en Windows escribe BOM; si no se quita, la primera cabecera deja de
  // coincidir con su nombre y toda la columna se pierde en silencio.
  const src = text.replace(/^﻿/, '');

  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let enComillas = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (enComillas) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        celda += c;
      }
      continue;
    }

    if (c === '"') {
      enComillas = true;
    } else if (c === ',' || c === ';') {
      // `;` también: es el separador por defecto de Excel en locales con coma
      // decimal, que es justo el caso de El Salvador.
      fila.push(celda);
      celda = '';
    } else if (c === '\n') {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else if (c === '\r') {
      // Se ignora: el '\n' que sigue cierra la fila.
    } else {
      celda += c;
    }
  }

  // Última fila sin salto final.
  if (celda !== '' || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }

  // Descarta filas totalmente vacías (Excel suele dejar una al final).
  return filas.filter((f) => f.some((c) => c.trim() !== ''));
}

export type MemberRow = {
  document_number: string;
  full_name: string;
  phone?: string;
  relationship?: string;
  starts_on?: string;
  ends_on?: string;
};

/** Cabeceras aceptadas por columna, en minúsculas y sin acentos. */
const ALIAS: Record<keyof MemberRow, string[]> = {
  document_number: ['document_number', 'documento', 'dui', 'num_documento', 'numero de documento'],
  full_name: ['full_name', 'nombre', 'nombre completo', 'nombres'],
  phone: ['phone', 'telefono', 'tel', 'celular'],
  relationship: ['relationship', 'relacion', 'parentesco', 'tipo'],
  starts_on: ['starts_on', 'alta', 'fecha_alta', 'inicio', 'vigencia_desde'],
  ends_on: ['ends_on', 'baja', 'fecha_baja', 'fin', 'vigencia_hasta'],
};

function normaliza(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export type MapeoCsv = {
  members: MemberRow[];
  /** Cabeceras del archivo que no se reconocieron (se ignoran). */
  columnasIgnoradas: string[];
  /** Columnas obligatorias que no aparecen en el archivo. */
  faltantes: string[];
};

/**
 * Convierte el CSV en afiliados. Acepta las cabeceras en español o en inglés y
 * en cualquier orden — quien exporta el padrón desde su sistema no tiene por qué
 * conocer los nombres internos.
 */
export function mapearAfiliados(filas: string[][]): MapeoCsv {
  if (filas.length === 0) {
    return { members: [], columnasIgnoradas: [], faltantes: ['document_number', 'full_name'] };
  }

  const cabeceras = filas[0].map(normaliza);
  const indice = {} as Record<keyof MemberRow, number>;
  const reconocidas = new Set<number>();

  (Object.keys(ALIAS) as (keyof MemberRow)[]).forEach((campo) => {
    const i = cabeceras.findIndex((h) => ALIAS[campo].includes(h));
    indice[campo] = i;
    if (i >= 0) reconocidas.add(i);
  });

  const faltantes: string[] = [];
  if (indice.document_number < 0) faltantes.push('documento / DUI');
  if (indice.full_name < 0) faltantes.push('nombre');

  const columnasIgnoradas = filas[0].filter((_, i) => !reconocidas.has(i)).filter((h) => h.trim() !== '');

  const valor = (fila: string[], campo: keyof MemberRow): string =>
    indice[campo] >= 0 ? (fila[indice[campo]] ?? '').trim() : '';

  const members = filas.slice(1).map((fila) => {
    const m: MemberRow = {
      document_number: valor(fila, 'document_number'),
      full_name: valor(fila, 'full_name'),
    };
    // Los opcionales solo se envían si traen algo: así la base aplica sus
    // valores por defecto en vez de recibir cadenas vacías.
    const phone = valor(fila, 'phone');
    const relationship = valor(fila, 'relationship');
    const startsOn = valor(fila, 'starts_on');
    const endsOn = valor(fila, 'ends_on');
    if (phone) m.phone = phone;
    if (relationship) m.relationship = traduceRelacion(relationship);
    if (startsOn) m.starts_on = normalizaFecha(startsOn);
    if (endsOn) m.ends_on = normalizaFecha(endsOn);
    return m;
  });

  return { members, columnasIgnoradas, faltantes };
}

/** Acepta la relación en español; lo demás pasa tal cual y lo valida la base. */
function traduceRelacion(v: string): string {
  const n = normaliza(v);
  if (['titular', 'holder'].includes(n)) return 'holder';
  if (['beneficiario', 'beneficiaria', 'beneficiary', 'dependiente'].includes(n)) return 'beneficiary';
  return n;
}

/**
 * Lleva la fecha a ISO. Excel suele escribir dd/mm/aaaa, que `date` interpretaría
 * como mm/dd — un padrón con altas del 03/04 quedaría desplazado tres meses sin
 * que nadie lo note.
 */
function normalizaFecha(v: string): string {
  const s = v.trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mes, a] = m;
    return `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return s;
}

/** Plantilla de ejemplo para descargar desde el panel. */
export const CSV_PLANTILLA = [
  'documento,nombre,telefono,relacion,alta,baja',
  '01234567-8,Juan Perez,+503 7000-0001,titular,01/01/2026,',
  '02345678-9,Maria Perez,+503 7000-0002,beneficiario,01/01/2026,31/12/2026',
].join('\n');
