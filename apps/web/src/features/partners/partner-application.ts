// Registro del socio (migr. 00114, backlog AGT-02/03): tipos y reglas de la
// solicitud compartidos por el registro web y la revisión del admin. La base
// vuelve a validar todo; esto es para avisar antes de enviar.

export type DocType = 'dui_front' | 'dui_back' | 'license' | 'nit' | 'circulation' | 'tow_photo' | 'insurance';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type AppState = 'draft' | 'in_review' | 'approved' | 'rejected' | 'suspended';

export type AppDocument = {
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
  state: AppState;
  rejection_reason: string | null;
  can_edit: boolean;
  independent: boolean;
  identity: { full_name: string | null; phone: string | null; dui: string | null; nit: string | null };
  services: string[];
  bank: { bank_name: string; account_type: 'ahorro' | 'corriente'; account_last4: string; holder: string } | null;
  vehicle: { plate: string; vehicle_type: string; capacity_m3: number | null } | null;
  documents: Partial<Record<DocType, AppDocument>>;
  missing: string[];
  /** 00126 (AGT-04): contrato vigente y si ya lo aceptó. */
  terms?: { id: string; version: string; title: string; accepted_at: string | null } | null;
  terms_pending?: boolean;
};

/** En orden de carga, con su bucket (el mismo que exige la base) y si vence. */
export const DOCS: { type: DocType; label: string; bucket: 'id-documents' | 'vehicle-documents'; expires: boolean; hint: string }[] = [
  { type: 'dui_front', label: 'DUI (frente)', bucket: 'id-documents', expires: false, hint: 'Foto nítida, sin reflejos, con los cuatro bordes.' },
  { type: 'dui_back', label: 'DUI (reverso)', bucket: 'id-documents', expires: false, hint: 'Que se lea el código de barras.' },
  { type: 'license', label: 'Licencia de conducir', bucket: 'id-documents', expires: true, hint: 'Vigente, del tipo que corresponde a tu unidad.' },
  { type: 'nit', label: 'NIT', bucket: 'id-documents', expires: false, hint: 'Tarjeta de NIT o constancia de Hacienda.' },
  { type: 'circulation', label: 'Tarjeta de circulación', bucket: 'vehicle-documents', expires: true, hint: 'De la unidad con la que vas a trabajar.' },
  { type: 'tow_photo', label: 'Foto de tu unidad', bucket: 'vehicle-documents', expires: false, hint: 'Completa y con la placa visible.' },
  { type: 'insurance', label: 'Seguro del vehículo', bucket: 'vehicle-documents', expires: true, hint: 'Póliza vigente de la unidad.' },
];

export const DOC_LABEL: Record<DocType, string> = Object.fromEntries(DOCS.map((d) => [d.type, d.label])) as Record<DocType, string>;

export const STATE_LABEL: Record<AppState, string> = {
  draft: 'Registro sin enviar',
  in_review: 'En revisión',
  approved: 'Aprobado',
  rejected: 'Hay cosas por corregir',
  suspended: 'Cuenta en pausa',
};

/** DUI: 9 dígitos, ########-#. */
export function formatDui(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  return d.length === 9 ? `${d.slice(0, 8)}-${d.slice(8)}` : null;
}

/** NIT: 14 dígitos, ####-######-###-#. */
export function formatNit(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 4)}-${d.slice(4, 10)}-${d.slice(10, 13)}-${d.slice(13)}` : null;
}

/** Pasos del registro y si están completos, según lo que la base dice que falta. */
export function stepStatus(app: PartnerApplication) {
  const m = new Set(app.missing);
  return {
    identity: !m.has('identidad'),
    vehicle: !m.has('unidad'),
    services: !app.independent || !m.has('servicios'),
    bank: !app.independent || !m.has('cuenta_bancaria'),
    documents: !app.missing.some((x) => x.startsWith('documento:')),
    contract: !app.terms_pending,
  };
}

/** ¿Se puede (re)subir este documento? En edición, o renovación de uno que vence. */
export function canUpload(app: PartnerApplication, doc?: AppDocument): boolean {
  return app.can_edit || !!(doc && (doc.expired || doc.expiring_soon));
}

/** Ruta única por subida: nunca se sobrescribe un archivo ya revisado. */
export function uploadPath(uid: string, type: DocType, fileName: string, now = Date.now()): string {
  const dot = fileName.lastIndexOf('.');
  const ext = (dot > 0 ? fileName.slice(dot + 1) : '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
  return `${uid}/${type}-${now}.${ext}`;
}
