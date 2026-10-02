// Registro del socio operador por pasos (backlog AGT-02/AGT-03, migr. 00114).
// Tipos del avance que devuelve `my_partner_application()`, catálogos y
// validaciones puras (sin React) para poder probarlas con vitest. La base
// valida lo mismo: esto solo evita viajes inútiles y da mensajes inmediatos.

import { friendlyError } from './errorMessages';

export type PartnerState = 'draft' | 'in_review' | 'approved' | 'rejected' | 'suspended';
export type VehicleType = 'tow_light' | 'tow_heavy' | 'water_truck' | 'service';
export type AccountType = 'ahorro' | 'corriente';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export type DocType =
  | 'dui_front'
  | 'dui_back'
  | 'license'
  | 'nit'
  | 'circulation'
  | 'tow_photo'
  | 'insurance';

export type PartnerDocument = {
  path: string;
  bucket: string;
  uploaded_at: string;
  expires_on: string | null;
  review_status: ReviewStatus;
  review_note: string | null;
  expired: boolean;
  expiring_soon: boolean;
};

export type PartnerApplication = {
  state: PartnerState;
  rejection_reason: string | null;
  can_edit: boolean;
  independent: boolean;
  identity: { full_name: string | null; phone: string | null; dui: string | null; nit: string | null };
  services: string[];
  bank: { bank_name: string; account_type: AccountType; account_last4: string; holder: string } | null;
  vehicle: { plate: string; vehicle_type: VehicleType; capacity_m3: number | null } | null;
  documents: Partial<Record<DocType, PartnerDocument>>;
  missing: string[];
  /** 00126 (AGT-04): contrato vigente y si ya lo aceptó. */
  terms?: { id: string; version: string; title: string; accepted_at: string | null } | null;
  terms_pending?: boolean;
};

/**
 * Estado del registro a partir de las columnas del perfil (misma regla que
 * my_partner_application): pendiente sin enviar = borrador; enviado = en revisión.
 */
export function partnerStateFromProfile(
  status: string | null | undefined,
  submittedAt: string | null | undefined,
): PartnerState {
  if (status === 'approved' || status === 'rejected' || status === 'suspended') return status;
  return submittedAt ? 'in_review' : 'draft';
}

export type DocConfig = {
  type: DocType;
  bucket: 'id-documents' | 'vehicle-documents';
  label: string;
  hint: string;
  expires: boolean;
};

// Los 7 son obligatorios (partner_required_docs). license, circulation e
// insurance llevan fecha de vencimiento (partner_expiring_docs).
export const PARTNER_DOCS: DocConfig[] = [
  { type: 'dui_front', bucket: 'id-documents', label: 'DUI (frente)', hint: 'Foto clara del frente de tu DUI', expires: false },
  { type: 'dui_back', bucket: 'id-documents', label: 'DUI (reverso)', hint: 'Foto clara del reverso de tu DUI', expires: false },
  { type: 'nit', bucket: 'id-documents', label: 'NIT', hint: 'Tarjeta o constancia de tu NIT', expires: false },
  { type: 'license', bucket: 'id-documents', label: 'Licencia de conducir', hint: 'Vigente (pesada si tu grúa es pesada)', expires: true },
  { type: 'circulation', bucket: 'vehicle-documents', label: 'Tarjeta de circulación', hint: 'De la unidad que vas a usar', expires: true },
  { type: 'tow_photo', bucket: 'vehicle-documents', label: 'Foto de la unidad', hint: 'Foto donde se vea la unidad y su placa', expires: false },
  { type: 'insurance', bucket: 'vehicle-documents', label: 'Póliza de seguro', hint: 'Póliza vigente de la unidad', expires: true },
];

export const VEHICLE_TYPES: { value: VehicleType; label: string }[] = [
  { value: 'tow_light', label: 'Grúa liviana' },
  { value: 'tow_heavy', label: 'Grúa pesada' },
  { value: 'water_truck', label: 'Pipa de agua' },
  { value: 'service', label: 'Vehículo de servicio' },
];

export const PARTNER_SERVICES: { value: string; label: string }[] = [
  { value: 'tow', label: 'Grúa' },
  { value: 'winch', label: 'Winche' },
  { value: 'battery', label: 'Batería' },
  { value: 'tire', label: 'Llanta' },
  { value: 'fuel', label: 'Combustible' },
  { value: 'locksmith', label: 'Cerrajería' },
  { value: 'mechanic', label: 'Mecánico' },
  { value: 'water_truck', label: 'Pipa de agua' },
];

const digits = (s: string) => s.replace(/\D/g, '');

/** DUI: 9 dígitos -> ########-#. null si no son 9. */
export function formatDui(raw: string): string | null {
  const d = digits(raw);
  return d.length === 9 ? `${d.slice(0, 8)}-${d.slice(8)}` : null;
}

/** NIT: 14 dígitos -> ####-######-###-#. null si no son 14. */
export function formatNit(raw: string): string | null {
  const d = digits(raw);
  return d.length === 14 ? `${d.slice(0, 4)}-${d.slice(4, 10)}-${d.slice(10, 13)}-${d.slice(13)}` : null;
}

/** Teléfono de El Salvador: 8 dígitos que empiezan en 2, 6 o 7 (con o sin +503). */
export function normalizeSvPhone(raw: string): string | null {
  const d = digits(raw).replace(/^503(?=\d{8}$)/, '');
  return /^[267]\d{7}$/.test(d) ? d : null;
}

/** Para mostrar en el campo: "+50370001234" -> "7000-1234". */
export function displaySvPhone(raw: string | null | undefined): string {
  const d = normalizeSvPhone(raw ?? '');
  return d ? `${d.slice(0, 4)}-${d.slice(4)}` : raw ?? '';
}

/**
 * Fecha escrita como DD/MM/AAAA (también acepta - o .) -> 'YYYY-MM-DD'.
 * null si el formato no es válido o la fecha no existe (p. ej. 31/02).
 */
export function parseDmy(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const [dd, mm, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (date.getUTCFullYear() !== yyyy || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) {
    return null;
  }
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' -> 'DD/MM/AAAA'. */
export function formatIsoAsDmy(iso: string | null | undefined): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Autoformato mientras se escribe: "01122027" -> "01/12/2027". */
export function maskDmy(raw: string): string {
  const d = digits(raw).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** ¿La fecha ISO es posterior a hoy (fecha local)? */
export function isFutureIso(iso: string, today: Date = new Date()): boolean {
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return iso > t;
}

export type DocDisplayStatus = 'missing' | 'pending' | 'approved' | 'rejected' | 'expired' | 'expiring';

/** Estado visible de un documento: lo más urgente primero (vencido > rechazado > por vencer). */
export function docDisplayStatus(doc: PartnerDocument | undefined): DocDisplayStatus {
  if (!doc) return 'missing';
  if (doc.expired) return 'expired';
  if (doc.review_status === 'rejected') return 'rejected';
  if (doc.expiring_soon) return 'expiring';
  return doc.review_status === 'approved' ? 'approved' : 'pending';
}

/** Nombre legible de cada entrada de `missing` (para el "Falta completar"). */
export function missingLabel(key: string): string {
  const map: Record<string, string> = {
    identidad: 'Datos personales',
    unidad: 'Tu unidad',
    servicios: 'Servicios',
    cuenta_bancaria: 'Cuenta bancaria',
    contrato: 'Aceptar el contrato',
  };
  if (map[key]) return map[key];
  if (key.startsWith('documento:')) {
    const t = key.slice('documento:'.length);
    return PARTNER_DOCS.find((d) => d.type === t)?.label ?? t;
  }
  return key;
}

/**
 * Mensaje para el socio a partir del error de una RPC. Las excepciones que
 * levanta la base (RAISE EXCEPTION -> código P0001) ya vienen en español y
 * explican qué corregir, así que se muestran tal cual; el resto (red, errores
 * internos) pasa por friendlyError.
 */
export function rpcErrorMessage(
  error: { message?: string; code?: string } | null | undefined,
  fallback: string,
): string {
  if (error?.code === 'P0001' && error.message) {
    // "Falta completar: identidad, documento:nit" -> nombres legibles.
    const m = error.message.match(/^Falta completar: (.+)$/);
    if (m) return `Falta completar: ${m[1].split(', ').map(missingLabel).join(', ')}`;
    return error.message;
  }
  return friendlyError(error, fallback);
}

/**
 * Cuenta en pausa: por qué y qué hacer. Hay dos causas y piden cosas
 * distintas. La automática (check_operator_document_expiry) deja como motivo
 * "Documento vencido: …" y se resuelve subiendo la renovación. La que pone
 * Budi a mano (Verificaciones → Pausar cuenta) trae su propio motivo y se
 * resuelve hablando con soporte: mandarlo a "actualizar documentos" no la
 * levanta nunca.
 */
export type PauseInfo = {
  title: string;
  text: string;
  /** true: el registro (subir la renovación). false: contactar a soporte. */
  byDocuments: boolean;
  cta: string;
};

export function pauseInfo(reason: string | null | undefined): PauseInfo {
  const byDocuments = /^Documento vencido/i.test((reason ?? '').trim());
  return byDocuments
    ? {
        title: 'Cuenta en pausa',
        text: 'Venció un documento. Sube la renovación desde tu registro para volver a recibir solicitudes.',
        byDocuments,
        cta: 'Subir la renovación',
      }
    : {
        title: 'Cuenta en pausa',
        text: 'Budi pausó tu cuenta. Escríbenos a soporte para resolverlo.',
        byDocuments,
        cta: 'Contactar a soporte',
      };
}
