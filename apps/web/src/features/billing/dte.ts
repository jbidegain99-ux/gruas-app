// Documento Tributario Electrónico (DTE) del Ministerio de Hacienda de El
// Salvador — base de LAN-09. Arma el JSON de una Factura (01, versión 1) o de
// un Comprobante de Crédito Fiscal (03, versión 3). NO firma ni transmite: eso
// necesita el certificado y las credenciales de la API del MH.
//
// Lecciones del facturador de Republicode que se respetan aquí:
//   * todo monto se redondea a 2 decimales por línea y se suman las líneas ya
//     redondeadas (el MH rechaza diferencias de centavos);
//   * la dirección del receptor va normalizada (departamento y municipio con
//     sus códigos de 2 dígitos, complemento sin saltos de línea);
//   * la fecha del MH llega como "dd/MM/yyyy HH:mm:ss" (parseMhDate);
//   * el token de la API va SIN el prefijo "Bearer" (para cuando se transmita).

export type DteType = '01' | '03';

export type Direccion = { departamento: string; municipio: string; complemento: string };

export type Emisor = {
  nit: string;
  nrc: string;
  nombre: string;
  codActividad: string;
  descActividad: string;
  nombreComercial: string | null;
  tipoEstablecimiento: string; // 01 sucursal, 02 casa matriz…
  direccion: Direccion;
  telefono: string;
  correo: string;
  codEstableMH: string | null;
  codPuntoVentaMH: string | null;
};

export type Receptor = {
  nombre: string;
  nit?: string | null;
  nrc?: string | null;
  codActividad?: string | null;
  descActividad?: string | null;
  nombreComercial?: string | null;
  // Factura (01): documento del receptor.
  tipoDocumento?: string | null; // 36 NIT, 13 DUI…
  numDocumento?: string | null;
  direccion?: Partial<Direccion> | null;
  telefono?: string | null;
  correo?: string | null;
};

export type DteItem = { descripcion: string; cantidad: number; precio: number; codigo?: string | null };

export type DteOptions = {
  tipo: DteType;
  ambiente: '00' | '01';
  codEstable: string;
  codPuntoVenta: string;
  correlativo: number; // se asigna al transmitir; en borrador va 0
  codigoGeneracion: string;
  fecha: Date;
  /** ¿Los precios de los ítems ya traen el IVA? */
  preciosIncluyenIva: boolean;
  condicionOperacion: 1 | 2 | 3; // 1 contado, 2 crédito, 3 otro
  ivaRete1?: number; // retención del 1 % (gran contribuyente); la decide el contador
};

const IVA = 0.13;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function numeroControl(tipo: DteType, codEstable: string, codPuntoVenta: string, correlativo: number): string {
  return `DTE-${tipo}-${codEstable.toUpperCase()}${codPuntoVenta.toUpperCase()}-${String(correlativo).padStart(15, '0')}`;
}

/** Fecha y hora de emisión en hora de El Salvador. */
export function fechaHoraSV(d: Date): { fecEmi: string; horEmi: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/El_Salvador', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return { fecEmi: `${parts.year}-${parts.month}-${parts.day}`, horEmi: `${parts.hour}:${parts.minute}:${parts.second}` };
}

/** "dd/MM/yyyy HH:mm:ss" (hora de El Salvador, UTC-6) → Date. */
export function parseMhDate(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-06:00`);
}

export function normalizeDireccion(d: Partial<Direccion> | null | undefined): Direccion | null {
  if (!d) return null;
  const dep = String(d.departamento ?? '').trim().padStart(2, '0');
  const mun = String(d.municipio ?? '').trim().padStart(2, '0');
  const comp = String(d.complemento ?? '').replace(/\s+/g, ' ').trim();
  if (!/^\d{2}$/.test(dep) || !/^\d{2}$/.test(mun) || !comp) return null;
  return { departamento: dep, municipio: mun, complemento: comp.slice(0, 200) };
}

const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE',
  'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS',
  'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS',
  'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function menorMil(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r < 30) {
    if (r) partes.push(UNIDADES[r]);
  } else {
    const d = Math.floor(r / 10);
    const u = r % 10;
    partes.push(u ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d]);
  }
  return partes.join(' ');
}

/** Entero en letras (hasta 999 999 999). */
export function enteroEnLetras(n: number): string {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  // Delante de MIL/MILLONES: "UNO" se apocopa ("VEINTIÚN MIL", "TREINTA Y UN MIL").
  const apocope = (t: string) => t.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/UNO$/, 'UN');
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${apocope(menorMil(millones))} MILLONES`);
  if (miles) partes.push(miles === 1 ? 'MIL' : `${apocope(menorMil(miles))} MIL`);
  if (resto) partes.push(menorMil(resto));
  return partes.join(' ');
}

/** "CIENTO VEINTITRÉS 45/100 DÓLARES" */
export function totalEnLetras(total: number): string {
  const t = round2(total);
  const entero = Math.floor(t);
  const cent = Math.round((t - entero) * 100);
  return `${enteroEnLetras(entero)} ${String(cent).padStart(2, '0')}/100 DÓLARES`;
}

/** Campos que faltan para poder emitir (se muestran antes de generar). */
export function missingFields(tipo: DteType, emisor: Partial<Emisor>, receptor: Partial<Receptor>): string[] {
  const faltan: string[] = [];
  const need = (ok: unknown, label: string) => { if (!ok) faltan.push(label); };
  need(emisor.nit, 'Emisor: NIT');
  need(emisor.nrc, 'Emisor: NRC');
  need(emisor.nombre, 'Emisor: nombre o razón social');
  need(emisor.codActividad && emisor.descActividad, 'Emisor: actividad económica');
  need(normalizeDireccion(emisor.direccion), 'Emisor: dirección (departamento, municipio y complemento)');
  need(emisor.telefono, 'Emisor: teléfono');
  need(emisor.correo, 'Emisor: correo');
  need(receptor.nombre, 'Receptor: nombre');
  if (tipo === '03') {
    need(receptor.nit, 'Receptor: NIT');
    need(receptor.nrc, 'Receptor: NRC');
    need(receptor.codActividad && receptor.descActividad, 'Receptor: actividad económica');
    need(normalizeDireccion(receptor.direccion), 'Receptor: dirección');
    need(receptor.correo, 'Receptor: correo');
  }
  return faltan;
}

type Linea = { base: number; iva: number; total: number };

/** Reparte cada precio en base gravada e IVA según el tipo y si trae IVA. */
function linea(precio: number, cantidad: number, incluyeIva: boolean): Linea {
  const bruto = round2(precio * cantidad);
  if (incluyeIva) {
    const base = round2(bruto / (1 + IVA));
    return { base, iva: round2(bruto - base), total: bruto };
  }
  const iva = round2(bruto * IVA);
  return { base: bruto, iva, total: round2(bruto + iva) };
}

export function buildDte(emisor: Emisor, receptor: Receptor, items: DteItem[], o: DteOptions): Record<string, unknown> {
  const { fecEmi, horEmi } = fechaHoraSV(o.fecha);
  const lineas = items.map((it) => linea(it.precio, it.cantidad, o.preciosIncluyenIva));
  const identificacion = {
    version: o.tipo === '01' ? 1 : 3,
    ambiente: o.ambiente,
    tipoDte: o.tipo,
    numeroControl: numeroControl(o.tipo, o.codEstable, o.codPuntoVenta, o.correlativo),
    codigoGeneracion: o.codigoGeneracion.toUpperCase(),
    tipoModelo: 1,
    tipoOperacion: 1,
    tipoContingencia: null,
    motivoContin: null,
    fecEmi,
    horEmi,
    tipoMoneda: 'USD',
  };
  const emisorDte = {
    ...emisor,
    direccion: normalizeDireccion(emisor.direccion),
    codEstable: o.codEstable,
    codPuntoVenta: o.codPuntoVenta,
  };
  const ivaRete1 = round2(o.ivaRete1 ?? 0);

  if (o.tipo === '01') {
    // Factura: el precio unitario va CON IVA y cada ítem declara su ivaItem.
    const cuerpo = items.map((it, i) => ({
      numItem: i + 1, tipoItem: 2, numeroDocumento: null, cantidad: it.cantidad, codigo: it.codigo ?? null,
      codTributo: null, uniMedida: 99, descripcion: it.descripcion,
      precioUni: round2(lineas[i].total / it.cantidad), montoDescu: 0, ventaNoSuj: 0, ventaExenta: 0,
      ventaGravada: lineas[i].total, tributos: null, psv: 0, noGravado: 0, ivaItem: lineas[i].iva,
    }));
    const totalGravada = round2(lineas.reduce((a, l) => a + l.total, 0));
    const totalIva = round2(lineas.reduce((a, l) => a + l.iva, 0));
    const totalPagar = round2(totalGravada - ivaRete1);
    return {
      identificacion, documentoRelacionado: null, emisor: emisorDte,
      receptor: {
        tipoDocumento: receptor.tipoDocumento ?? null, numDocumento: receptor.numDocumento ?? null,
        nrc: receptor.nrc ?? null, nombre: receptor.nombre, codActividad: receptor.codActividad ?? null,
        descActividad: receptor.descActividad ?? null, direccion: normalizeDireccion(receptor.direccion),
        telefono: receptor.telefono ?? null, correo: receptor.correo ?? null,
      },
      otrosDocumentos: null, ventaTercero: null, cuerpoDocumento: cuerpo,
      resumen: {
        totalNoSuj: 0, totalExenta: 0, totalGravada, subTotalVentas: totalGravada, descuNoSuj: 0, descuExenta: 0,
        descuGravada: 0, porcentajeDescuento: 0, totalDescu: 0, tributos: null, subTotal: totalGravada, ivaRete1,
        reteRenta: 0, montoTotalOperacion: totalGravada, totalNoGravado: 0, totalPagar,
        totalLetras: totalEnLetras(totalPagar), totalIva, saldoFavor: 0, condicionOperacion: o.condicionOperacion,
        pagos: null, numPagoElectronico: null,
      },
      extension: null, apendice: null,
    };
  }

  // Crédito fiscal: precio unitario SIN IVA; el IVA va en el resumen (tributo 20).
  // Si los precios traen IVA, la base total sale del total con IVA y el centavo
  // de redondeo se absorbe en la última línea: así el documento suma exactamente
  // lo que el cliente aprobó (sumar bases ya redondeadas perdía un centavo).
  if (o.preciosIncluyenIva && lineas.length > 0) {
    const target = round2(lineas.reduce((a, l) => a + l.total, 0) / (1 + IVA));
    const diff = round2(target - lineas.reduce((a, l) => a + l.base, 0));
    const last = lineas[lineas.length - 1];
    lineas[lineas.length - 1] = { ...last, base: round2(last.base + diff) };
  }
  const cuerpo = items.map((it, i) => ({
    numItem: i + 1, tipoItem: 2, numeroDocumento: null, codigo: it.codigo ?? null, codTributo: null,
    descripcion: it.descripcion, cantidad: it.cantidad, uniMedida: 99,
    precioUni: round2(lineas[i].base / it.cantidad), montoDescu: 0, ventaNoSuj: 0, ventaExenta: 0,
    ventaGravada: lineas[i].base, tributos: ['20'], psv: 0, noGravado: 0,
  }));
  const totalGravada = round2(lineas.reduce((a, l) => a + l.base, 0));
  const iva = round2(totalGravada * IVA);
  const montoTotal = round2(totalGravada + iva);
  const totalPagar = round2(montoTotal - ivaRete1);
  return {
    identificacion, documentoRelacionado: null, emisor: emisorDte,
    receptor: {
      nit: receptor.nit ?? null, nrc: receptor.nrc ?? null, nombre: receptor.nombre,
      codActividad: receptor.codActividad ?? null, descActividad: receptor.descActividad ?? null,
      nombreComercial: receptor.nombreComercial ?? null, direccion: normalizeDireccion(receptor.direccion),
      telefono: receptor.telefono ?? null, correo: receptor.correo ?? null,
    },
    otrosDocumentos: null, ventaTercero: null, cuerpoDocumento: cuerpo,
    resumen: {
      totalNoSuj: 0, totalExenta: 0, totalGravada, subTotalVentas: totalGravada, descuNoSuj: 0, descuExenta: 0,
      descuGravada: 0, porcentajeDescuento: 0, totalDescu: 0,
      tributos: [{ codigo: '20', descripcion: 'Impuesto al Valor Agregado 13%', valor: iva }],
      subTotal: totalGravada, ivaPerci1: 0, ivaRete1, reteRenta: 0, montoTotalOperacion: montoTotal,
      totalNoGravado: 0, totalPagar, totalLetras: totalEnLetras(totalPagar), saldoFavor: 0,
      condicionOperacion: o.condicionOperacion, pagos: null, numPagoElectronico: null,
    },
    extension: null, apendice: null,
  };
}
