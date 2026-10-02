import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Circle,
  Upload,
  ShieldCheck,
  Clock,
  ShieldX,
  ShieldAlert,
  ClipboardList,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import {
  PARTNER_DOCS,
  PARTNER_SERVICES,
  VEHICLE_TYPES,
  displaySvPhone,
  docDisplayStatus,
  formatDui,
  formatIsoAsDmy,
  formatNit,
  isFutureIso,
  maskDmy,
  missingLabel,
  normalizeSvPhone,
  parseDmy,
  rpcErrorMessage,
  type AccountType,
  type DocConfig,
  type DocDisplayStatus,
  type DocType,
  type PartnerApplication,
  pauseInfo,
  type VehicleType,
} from '@/lib/partnerApplication';
import { Button, Input, LoadingSpinner, ErrorState, toast } from '@/shared/components/ui';
import { PartnerTerms } from '@/features/partners/components/PartnerTerms';
import { colors, typography, spacing, radii } from '@/theme';

// Registro del socio operador por pasos (AGT-02/AGT-03, migr. 00114). Cada
// sección se guarda por separado con su RPC, así el socio puede continuar en
// otra sesión. El avance (qué falta, estado, si se puede editar) lo decide la
// base con my_partner_application(); la pantalla solo lo refleja.

type SectionKey = 'identidad' | 'unidad' | 'servicios' | 'cuenta_bancaria' | 'documentos' | 'contrato';
type Feedback = { kind: 'error' | 'success'; text: string } | null;

const SECTION_TITLES: Record<SectionKey, string> = {
  identidad: 'Datos personales',
  unidad: 'Tu unidad',
  servicios: 'Servicios que ofreces',
  cuenta_bancaria: 'Cuenta bancaria',
  documentos: 'Documentos',
  contrato: 'Contrato',
};

const DOC_STATUS_UI: Record<DocDisplayStatus, { label: string; color: string; bg: string }> = {
  missing: { label: 'Sin subir', color: colors.text.secondary, bg: colors.background.tertiary },
  pending: { label: 'En revisión', color: colors.warning.dark, bg: colors.warning.light },
  approved: { label: 'Aprobado', color: colors.success.dark, bg: colors.success.light },
  rejected: { label: 'Rechazado', color: colors.error.dark, bg: colors.error.light },
  expired: { label: 'Vencido', color: colors.error.dark, bg: colors.error.light },
  expiring: { label: 'Por vencer', color: colors.warning.dark, bg: colors.warning.light },
};

export default function PartnerRegistration() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [app, setApp] = useState<PartnerApplication | null>(null);
  const [open, setOpen] = useState<SectionKey | null>(null);
  const [saving, setSaving] = useState<SectionKey | null>(null);
  const [feedback, setFeedback] = useState<Partial<Record<SectionKey | 'submit', Feedback>>>({});
  const [submitting, setSubmitting] = useState(false);
  const hydrated = useRef(false);

  // Formularios (se llenan con lo guardado en la primera carga).
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [dui, setDui] = useState('');
  const [nit, setNit] = useState('');
  const [plate, setPlate] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(null);
  const [capacity, setCapacity] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [bankName, setBankName] = useState('');
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [holder, setHolder] = useState('');

  // Documentos: fecha de vencimiento escrita, subida en curso, error y vista previa.
  const [expiry, setExpiry] = useState<Partial<Record<DocType, string>>>({});
  const [uploading, setUploading] = useState<DocType | null>(null);
  const [docError, setDocError] = useState<Partial<Record<DocType, string>>>({});
  const [preview, setPreview] = useState<Partial<Record<DocType, string>>>({});

  const hydrate = useCallback((a: PartnerApplication, only?: SectionKey) => {
    if (!only || only === 'identidad') {
      setFullName(a.identity.full_name ?? '');
      setPhone(displaySvPhone(a.identity.phone));
      setDui(a.identity.dui ?? '');
      setNit(a.identity.nit ?? '');
    }
    if (!only || only === 'unidad') {
      setPlate(a.vehicle?.plate ?? '');
      setVehicleType(a.vehicle?.vehicle_type ?? null);
      setCapacity(a.vehicle?.capacity_m3 != null ? String(a.vehicle.capacity_m3) : '');
    }
    if (!only || only === 'servicios') setServices(a.services ?? []);
    if (!only || only === 'cuenta_bancaria') {
      setBankName(a.bank?.bank_name ?? '');
      setAccountType(a.bank?.account_type ?? null);
      setAccountNumber(''); // nunca se muestra completo: solo los últimos 4
      setHolder(a.bank?.holder ?? '');
    }
    if (!only || only === 'documentos') {
      // La fecha vigente se muestra; si está por vencer o vencida, se pide la nueva.
      const next: Partial<Record<DocType, string>> = {};
      PARTNER_DOCS.forEach((d) => {
        const doc = a.documents[d.type];
        if (d.expires && doc && !doc.expired && !doc.expiring_soon) next[d.type] = formatIsoAsDmy(doc.expires_on);
      });
      setExpiry(next);
    }
  }, []);

  const load = useCallback(async (): Promise<PartnerApplication | null> => {
    setLoadError(false);
    const { data, error } = await supabase.rpc('my_partner_application');
    if (error || !data) {
      console.error('Error loading partner application:', error);
      setLoadError(true);
      setLoading(false);
      return null;
    }
    const a = data as unknown as PartnerApplication;
    setApp(a);
    if (!hydrated.current) {
      hydrated.current = true;
      hydrate(a);
      // Abre la primera sección pendiente (o Documentos si hay una renovación).
      const order: SectionKey[] = ['identidad', 'unidad'];
      if (a.independent) order.push('servicios', 'cuenta_bancaria');
      const firstPending = a.can_edit ? order.find((k) => a.missing.includes(k)) : undefined;
      const docsPending = a.missing.some((m) => m.startsWith('documento:'));
      const renewal = Object.values(a.documents).some((d) => d?.expired || d?.expiring_soon);
      setOpen(firstPending ?? ((a.can_edit && docsPending) || renewal ? 'documentos' : null));
    }
    setLoading(false);
    return a;
  }, [hydrate]);

  useEffect(() => {
    load();
  }, [load]);

  const setMsg = (key: SectionKey | 'submit', fb: Feedback) =>
    setFeedback((p) => ({ ...p, [key]: fb }));

  // Guarda una sección: valida en la UI, llama la RPC y recarga el avance.
  const saveSection = async (
    key: SectionKey,
    validate: () => string | null,
    call: () => PromiseLike<{ error: { message?: string; code?: string } | null }>,
  ) => {
    const invalid = validate();
    if (invalid) {
      setMsg(key, { kind: 'error', text: invalid });
      return;
    }
    setSaving(key);
    setMsg(key, null);
    const { error } = await call();
    if (error) {
      setSaving(null);
      setMsg(key, { kind: 'error', text: rpcErrorMessage(error, 'No se pudo guardar. Intenta de nuevo.') });
      return;
    }
    const a = await load();
    if (a) hydrate(a, key);
    setSaving(null);
    setMsg(key, { kind: 'success', text: 'Guardado. Puedes continuar después si quieres.' });
  };

  const saveIdentity = () =>
    saveSection(
      'identidad',
      () => {
        if (fullName.trim().length < 3) return 'Escribe tu nombre completo.';
        if (!normalizeSvPhone(phone)) return 'El teléfono debe ser de El Salvador (8 dígitos).';
        if (!formatDui(dui)) return 'El DUI tiene 9 dígitos (########-#).';
        if (!formatNit(nit)) return 'El NIT tiene 14 dígitos (####-######-###-#).';
        return null;
      },
      () =>
        supabase.rpc('partner_save_identity', {
          p_full_name: fullName.trim(),
          p_phone: normalizeSvPhone(phone) ?? phone,
          p_dui: formatDui(dui) ?? dui,
          p_nit: formatNit(nit) ?? nit,
        }),
    );

  const saveVehicle = () =>
    saveSection(
      'unidad',
      () => {
        if (!/^[A-Z0-9-]{3,12}$/.test(plate.replace(/\s+/g, '').toUpperCase())) return 'Escribe una placa válida.';
        if (!vehicleType) return 'Elige el tipo de unidad.';
        if (vehicleType === 'water_truck' && !(Number(capacity.replace(',', '.')) > 0)) {
          return 'Indica la capacidad de la pipa en m³.';
        }
        return null;
      },
      () =>
        supabase.rpc('partner_save_vehicle', {
          p_plate: plate,
          p_vehicle_type: vehicleType as string,
          ...(vehicleType === 'water_truck' ? { p_capacity_m3: Number(capacity.replace(',', '.')) } : {}),
        }),
    );

  const saveServices = () =>
    saveSection(
      'servicios',
      () => (services.length === 0 ? 'Elige al menos un servicio.' : null),
      () => supabase.rpc('partner_save_services', { p_service_types: services }),
    );

  const saveBank = () =>
    saveSection(
      'cuenta_bancaria',
      () => {
        if (bankName.trim().length < 2) return 'Indica el banco.';
        if (!accountType) return 'Elige el tipo de cuenta.';
        if (!/^\d{6,24}$/.test(accountNumber.replace(/\D/g, ''))) {
          return app?.bank
            ? 'Para cambiar la cuenta escribe el número completo otra vez.'
            : 'Escribe el número de cuenta (solo dígitos).';
        }
        if (holder.trim().length < 3) return 'Indica el titular de la cuenta.';
        return null;
      },
      () =>
        supabase.rpc('partner_save_bank', {
          p_bank_name: bankName.trim(),
          p_account_type: accountType as string,
          p_account_number: accountNumber.replace(/\D/g, ''),
          p_holder: holder.trim(),
        }),
    );

  // --- Documentos ---

  const docEditable = (d: DocConfig) => {
    if (!app) return false;
    const doc = app.documents[d.type];
    return app.can_edit || !!(doc && (doc.expired || doc.expiring_soon));
  };

  const uploadImage = async (d: DocConfig, uri: string, expiresOn: string | null) => {
    setUploading(d.type);
    setDocError((p) => ({ ...p, [d.type]: undefined }));
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Sesión no válida');

      // En web el picker devuelve un blob/data URI; en nativo, un archivo local.
      let body: ArrayBuffer;
      if (Platform.OS === 'web') {
        body = await (await fetch(uri)).arrayBuffer();
      } else {
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        if (!base64) throw new Error('No se pudo leer la imagen');
        body = decode(base64);
      }

      // Nombre único por subida y sin sobrescribir: Storage ya no deja
      // reemplazar el archivo de un socio en revisión o aprobado.
      const path = `${user.id}/${d.type}-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from(d.bucket)
        .upload(path, body, { contentType: 'image/jpeg', upsert: false });
      if (upErr) throw upErr;

      const { error: rpcErr } = await supabase.rpc('upsert_operator_document', {
        p_doc_type: d.type,
        p_bucket: d.bucket,
        p_path: path,
        ...(expiresOn ? { p_expires_on: expiresOn } : {}),
      });
      if (rpcErr) {
        setDocError((p) => ({ ...p, [d.type]: rpcErrorMessage(rpcErr, 'No se pudo guardar el documento.') }));
        return;
      }
      setPreview((p) => ({ ...p, [d.type]: uri }));
      const a = await load();
      if (a && d.expires) {
        setExpiry((p) => ({ ...p, [d.type]: formatIsoAsDmy(a.documents[d.type]?.expires_on) }));
      }
    } catch (err) {
      console.error('Upload error:', err);
      setDocError((p) => ({
        ...p,
        [d.type]: rpcErrorMessage(err as { message?: string }, 'No se pudo subir el documento. Intenta de nuevo.'),
      }));
    } finally {
      setUploading(null);
    }
  };

  const pickFromLibrary = async (d: DocConfig, expiresOn: string | null) => {
    const { status: perm } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm !== 'granted') {
      toast.error('Permite el acceso a la galería para subir el documento.', 'Permisos');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (!result.canceled && result.assets[0]) uploadImage(d, result.assets[0].uri, expiresOn);
  };

  const takePhoto = async (d: DocConfig, expiresOn: string | null) => {
    const { status: perm } = await ImagePicker.requestCameraPermissionsAsync();
    if (perm !== 'granted') {
      toast.error('Permite el acceso a la cámara para tomar la foto.', 'Permisos');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!result.canceled && result.assets[0]) uploadImage(d, result.assets[0].uri, expiresOn);
  };

  const startUpload = (d: DocConfig) => {
    let expiresOn: string | null = null;
    if (d.expires) {
      expiresOn = parseDmy(expiry[d.type] ?? '');
      if (!expiresOn) {
        setDocError((p) => ({ ...p, [d.type]: 'Escribe la fecha de vencimiento como DD/MM/AAAA.' }));
        return;
      }
      if (!isFutureIso(expiresOn)) {
        setDocError((p) => ({ ...p, [d.type]: 'La fecha de vencimiento tiene que ser posterior a hoy.' }));
        return;
      }
    }
    setDocError((p) => ({ ...p, [d.type]: undefined }));
    // Alert con botones no existe en web: ahí se abre directo el selector de archivos.
    if (Platform.OS === 'web') {
      pickFromLibrary(d, expiresOn);
      return;
    }
    Alert.alert(d.label, '¿De dónde quieres subir el documento?', [
      { text: 'Cámara', onPress: () => takePhoto(d, expiresOn) },
      { text: 'Galería', onPress: () => pickFromLibrary(d, expiresOn) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setMsg('submit', null);
    const { error } = await supabase.rpc('submit_operator_verification');
    if (error) {
      setSubmitting(false);
      setMsg('submit', { kind: 'error', text: rpcErrorMessage(error, 'No se pudo enviar a revisión. Intenta de nuevo.') });
      return;
    }
    await load();
    setSubmitting(false);
    setOpen(null);
    setMsg('submit', {
      kind: 'success',
      text: 'Enviado. Un administrador revisará tu registro y te avisaremos cuando esté aprobado.',
    });
  };

  if (loading) return <LoadingSpinner fullScreen />;

  if (loadError || !app) {
    return (
      <ErrorState
        fullScreen
        offline
        title="No pudimos cargar tu registro"
        message="Revisa tu conexión e intenta de nuevo."
        onRetry={load}
      />
    );
  }

  const editable = app.can_edit;
  const sections: SectionKey[] = ['identidad', 'unidad'];
  if (app.independent) sections.push('servicios', 'cuenta_bancaria');
  sections.push('documentos');
  // 00126 (AGT-04): el contrato vigente, aceptado (también una versión nueva
  // cuando el socio ya está aprobado).
  if (app.terms) sections.push('contrato');
  const isComplete = (k: SectionKey) =>
    k === 'documentos' ? !app.missing.some((m) => m.startsWith('documento:')) : !app.missing.includes(k);
  const doneCount = sections.filter(isComplete).length;
  const ready = app.missing.length === 0;

  const renderFeedback = (key: SectionKey | 'submit') => {
    const fb = feedback[key];
    if (!fb) return null;
    return (
      <Text
        style={[styles.feedback, { color: fb.kind === 'error' ? colors.error.main : colors.success.dark }]}
        accessibilityLiveRegion="polite"
      >
        {fb.text}
      </Text>
    );
  };

  const renderSaveButton = (key: SectionKey, onPress: () => void) =>
    editable ? (
      <View style={styles.saveWrap}>
        <Button
          title="Guardar"
          onPress={onPress}
          size="medium"
          variant="secondary"
          loading={saving === key}
          disabled={saving !== null}
        />
        {renderFeedback(key)}
      </View>
    ) : null;

  const renderChips = <T extends string>(
    options: { value: T; label: string }[],
    isSelected: (v: T) => boolean,
    onToggle: (v: T) => void,
    multi = false,
  ) => (
    <View style={styles.chips}>
      {options.map((o) => {
        const selected = isSelected(o.value);
        return (
          <Pressable
            key={o.value}
            style={[styles.chip, selected && styles.chipSelected, !editable && styles.chipDisabled]}
            onPress={() => onToggle(o.value)}
            disabled={!editable}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: selected, disabled: !editable }}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const renderSectionBody = (k: SectionKey): ReactNode => {
    switch (k) {
      case 'identidad':
        return (
          <View style={styles.form}>
            <Input label="Nombre completo" value={fullName} onChangeText={setFullName} disabled={!editable} autoCapitalize="words" />
            <Input label="Teléfono" value={phone} onChangeText={setPhone} disabled={!editable} keyboardType="phone-pad" placeholder="7000-0000" />
            <Input label="DUI" value={dui} onChangeText={setDui} disabled={!editable} keyboardType="number-pad" placeholder="########-#" />
            <Input label="NIT" value={nit} onChangeText={setNit} disabled={!editable} keyboardType="number-pad" placeholder="####-######-###-#" />
            {renderSaveButton('identidad', saveIdentity)}
          </View>
        );
      case 'unidad':
        return (
          <View style={styles.form}>
            <Input label="Placa" value={plate} onChangeText={(t) => setPlate(t.toUpperCase())} disabled={!editable} autoCapitalize="characters" placeholder="C123456" />
            <Text style={styles.fieldLabel}>Tipo de unidad</Text>
            {renderChips(VEHICLE_TYPES, (v) => v === vehicleType, (v) => setVehicleType(v))}
            {vehicleType === 'water_truck' && (
              <Input label="Capacidad de la pipa (m³)" value={capacity} onChangeText={setCapacity} disabled={!editable} keyboardType="decimal-pad" placeholder="10" />
            )}
            {renderSaveButton('unidad', saveVehicle)}
          </View>
        );
      case 'servicios':
        return (
          <View style={styles.form}>
            <Text style={styles.sectionHint}>Elige los servicios que puedes prestar con tu unidad.</Text>
            {renderChips(
              PARTNER_SERVICES,
              (v) => services.includes(v),
              (v) => setServices((p) => (p.includes(v) ? p.filter((s) => s !== v) : [...p, v])),
              true,
            )}
            {renderSaveButton('servicios', saveServices)}
          </View>
        );
      case 'cuenta_bancaria':
        return (
          <View style={styles.form}>
            <Text style={styles.sectionHint}>Aquí te depositamos lo que ganes por tus servicios.</Text>
            <Input label="Banco" value={bankName} onChangeText={setBankName} disabled={!editable} placeholder="Banco Agrícola" />
            <Text style={styles.fieldLabel}>Tipo de cuenta</Text>
            {renderChips<AccountType>(
              [
                { value: 'ahorro', label: 'Ahorro' },
                { value: 'corriente', label: 'Corriente' },
              ],
              (v) => v === accountType,
              (v) => setAccountType(v),
            )}
            {editable ? (
              <Input
                label="Número de cuenta"
                value={accountNumber}
                onChangeText={setAccountNumber}
                keyboardType="number-pad"
                placeholder={app.bank ? `Termina en ${app.bank.account_last4}` : 'Solo dígitos'}
              />
            ) : app.bank ? (
              <Text style={styles.readonlyValue}>Cuenta terminada en {app.bank.account_last4}</Text>
            ) : null}
            {editable && app.bank ? (
              <Text style={styles.sectionHint}>
                Tu cuenta termina en {app.bank.account_last4}. Para cambiarla escribe el número completo.
              </Text>
            ) : null}
            <Input label="Titular de la cuenta" value={holder} onChangeText={setHolder} disabled={!editable} autoCapitalize="words" />
            {renderSaveButton('cuenta_bancaria', saveBank)}
          </View>
        );
      case 'contrato':
        return (
          <PartnerTerms
            accepted={
              !app.terms_pending && app.terms?.accepted_at
                ? { version: app.terms.version, accepted_at: app.terms.accepted_at }
                : null
            }
            onAccepted={load}
          />
        );
      case 'documentos':
        return (
          <View style={styles.form}>
            <Text style={styles.sectionHint}>
              Fotos claras y legibles. La licencia, la tarjeta de circulación y la póliza llevan su fecha de vencimiento.
            </Text>
            {PARTNER_DOCS.map((d) => {
              const doc = app.documents[d.type];
              const st = docDisplayStatus(doc);
              const ui = DOC_STATUS_UI[st];
              const canUpload = docEditable(d);
              const isRenewal = !editable && canUpload;
              const busy = uploading === d.type;
              return (
                <View key={d.type} style={styles.docRow}>
                  <View style={styles.docTop}>
                    <View style={styles.docInfo}>
                      <Text style={styles.docLabel}>{d.label}</Text>
                      <Text style={styles.docHint}>{d.hint}</Text>
                    </View>
                    {preview[d.type] ? (
                      <Image source={{ uri: preview[d.type] }} style={styles.thumb} resizeMode="cover" />
                    ) : null}
                    <View style={[styles.statusPill, { backgroundColor: ui.bg }]}>
                      <Text style={[styles.statusPillText, { color: ui.color }]}>{ui.label}</Text>
                    </View>
                  </View>

                  {st === 'rejected' && doc?.review_note ? (
                    <Text style={styles.reviewNote}>Nota del revisor: {doc.review_note}</Text>
                  ) : null}
                  {doc?.expires_on && !canUpload ? (
                    <Text style={styles.docMeta}>Vence: {formatIsoAsDmy(doc.expires_on)}</Text>
                  ) : null}
                  {doc?.expires_on && canUpload && (st === 'expired' || st === 'expiring') ? (
                    <Text style={[styles.docMeta, { color: st === 'expired' ? colors.error.main : colors.warning.dark }]}>
                      {st === 'expired' ? 'Venció el' : 'Vence el'} {formatIsoAsDmy(doc.expires_on)}. Sube la renovación.
                    </Text>
                  ) : null}

                  {canUpload && (
                    <View style={styles.docActions}>
                      {d.expires && (
                        <View style={styles.expiryInput}>
                          <Input
                            label={isRenewal ? 'Nuevo vencimiento' : 'Fecha de vencimiento'}
                            value={expiry[d.type] ?? ''}
                            onChangeText={(t) => setExpiry((p) => ({ ...p, [d.type]: maskDmy(t) }))}
                            placeholder="DD/MM/AAAA"
                            keyboardType="number-pad"
                            maxLength={10}
                          />
                        </View>
                      )}
                      <Pressable
                        style={[styles.uploadBtn, doc && st !== 'rejected' && st !== 'expired' && styles.uploadBtnDone]}
                        onPress={() => startUpload(d)}
                        disabled={uploading !== null}
                        accessibilityRole="button"
                        accessibilityLabel={`Subir ${d.label}`}
                      >
                        {busy ? (
                          <ActivityIndicator size="small" color={colors.primary[500]} />
                        ) : (
                          <Upload size={16} color={colors.primary[500]} strokeWidth={2} />
                        )}
                        <Text style={styles.uploadBtnText}>
                          {isRenewal ? 'Subir renovación' : doc ? 'Cambiar' : 'Subir'}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                  {docError[d.type] ? <Text style={[styles.feedback, { color: colors.error.main }]}>{docError[d.type]}</Text> : null}
                </View>
              );
            })}
          </View>
        );
    }
  };

  const banner = (() => {
    switch (app.state) {
      case 'approved':
        return {
          Icon: ShieldCheck, color: colors.success.dark, bg: colors.success.light, border: colors.success.main,
          title: 'Registro aprobado',
          text: 'Tu cuenta está verificada y puedes recibir solicitudes. Mantén tus documentos vigentes.',
        };
      case 'in_review':
        return {
          Icon: Clock, color: colors.warning.dark, bg: colors.warning.light, border: colors.warning.main,
          title: 'En revisión',
          text: 'Un administrador está revisando tu registro. Te avisaremos cuando esté aprobado.',
        };
      case 'rejected':
        return {
          Icon: ShieldX, color: colors.error.dark, bg: colors.error.light, border: colors.error.main,
          title: 'Registro rechazado',
          text: 'Corrige lo que se indica y vuelve a enviar tu registro a revisión.',
          reason: app.rejection_reason,
        };
      case 'suspended':
        return {
          Icon: ShieldAlert, color: colors.error.dark, bg: colors.error.light, border: colors.error.main,
          title: pauseInfo(app.rejection_reason).title,
          text: pauseInfo(app.rejection_reason).text,
          reason: app.rejection_reason,
        };
      default:
        return {
          Icon: ClipboardList, color: colors.primary[700], bg: colors.primary[50], border: colors.primary[300],
          title: 'Completa tu registro',
          text: 'Llena cada sección y sube tus documentos. Tu avance se guarda: puedes continuar después.',
        };
    }
  })();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.m }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ChevronLeft size={24} color={colors.text.primary} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Registro de socio</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Banner de estado */}
        <View style={[styles.banner, { backgroundColor: banner.bg, borderColor: banner.border }]}>
          <banner.Icon size={22} color={banner.color} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: banner.color }]}>{banner.title}</Text>
            {'reason' in banner && banner.reason ? (
              <Text style={styles.bannerReason}>Motivo: {banner.reason}</Text>
            ) : null}
            <Text style={styles.bannerText}>{banner.text}</Text>
          </View>
        </View>

        {editable && (
          <Text style={styles.progress}>
            {doneCount} de {sections.length} secciones completas
          </Text>
        )}
        {!app.independent && (
          <Text style={styles.sectionHint}>
            Trabajas con una empresa: los servicios que ofreces y tus pagos los gestiona tu empresa.
          </Text>
        )}

        {sections.map((k, i) => {
          const complete = isComplete(k);
          const expanded = open === k;
          return (
            <View key={k} style={[styles.section, expanded && styles.sectionOpen]}>
              <Pressable
                style={styles.sectionHeader}
                onPress={() => setOpen(expanded ? null : k)}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`${SECTION_TITLES[k]}: ${complete ? 'completa' : 'pendiente'}`}
              >
                {complete ? (
                  <CircleCheck size={22} color={colors.success.main} strokeWidth={2} />
                ) : (
                  <View style={styles.stepNumber}>
                    <Circle size={22} color={colors.border.dark} strokeWidth={2} />
                    <Text style={styles.stepNumberText}>{i + 1}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>{SECTION_TITLES[k]}</Text>
                  <Text style={[styles.sectionStatus, { color: complete ? colors.success.dark : colors.text.tertiary }]}>
                    {complete ? 'Completa' : 'Pendiente'}
                  </Text>
                </View>
                {expanded ? (
                  <ChevronUp size={20} color={colors.text.secondary} strokeWidth={2} />
                ) : (
                  <ChevronDown size={20} color={colors.text.secondary} strokeWidth={2} />
                )}
              </Pressable>
              {expanded && <View style={styles.sectionBody}>{renderSectionBody(k)}</View>}
            </View>
          );
        })}

        {editable ? (
          <View style={styles.submitWrap}>
            <Button
              title="Enviar a revisión"
              onPress={handleSubmit}
              size="large"
              loading={submitting}
              disabled={submitting || !ready}
            />
            {!ready && (
              <Text style={styles.submitHint}>
                Falta completar: {app.missing.map(missingLabel).join(', ')}.
              </Text>
            )}
            {renderFeedback('submit')}
          </View>
        ) : (
          renderFeedback('submit')
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
  },
  content: {
    padding: spacing.l,
    paddingBottom: spacing.xxxl,
    gap: spacing.m,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s,
    padding: spacing.m,
    borderRadius: radii.l,
    borderWidth: 1,
  },
  bannerTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
  },
  bannerReason: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
    marginTop: spacing.micro,
  },
  bannerText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    lineHeight: 20,
    marginTop: spacing.micro,
  },
  progress: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
  },
  section: {
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colors.border.light,
    backgroundColor: colors.background.secondary,
    overflow: 'hidden',
  },
  sectionOpen: {
    borderColor: colors.primary[200],
    backgroundColor: colors.background.primary,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    padding: spacing.m,
  },
  stepNumber: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    position: 'absolute',
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
  sectionTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
  },
  sectionStatus: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    marginTop: 2,
  },
  sectionBody: {
    paddingHorizontal: spacing.m,
    paddingBottom: spacing.m,
  },
  sectionHint: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  form: {
    gap: spacing.m,
  },
  fieldLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginBottom: -spacing.xs,
  },
  readonlyValue: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.m,
    borderRadius: radii.full,
    borderWidth: 1.5,
    borderColor: colors.border.medium,
    backgroundColor: colors.background.primary,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipSelected: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  chipDisabled: {
    opacity: 0.6,
  },
  chipText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
  },
  chipTextSelected: {
    color: colors.primary[700],
  },
  saveWrap: {
    gap: spacing.xs,
  },
  feedback: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    lineHeight: 18,
  },
  docRow: {
    gap: spacing.xs,
    padding: spacing.m,
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colors.border.light,
    backgroundColor: colors.background.secondary,
  },
  docTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
  },
  docInfo: {
    flex: 1,
  },
  docLabel: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
  },
  docHint: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    marginTop: spacing.micro,
  },
  docMeta: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
  reviewNote: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.error.dark,
  },
  statusPill: {
    paddingVertical: 2,
    paddingHorizontal: spacing.s,
    borderRadius: radii.full,
  },
  statusPillText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.micro,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: radii.s,
  },
  docActions: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.s,
    marginTop: spacing.xs,
  },
  expiryInput: {
    flex: 1,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.m,
    minHeight: 44,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.primary[500],
    backgroundColor: colors.background.primary,
  },
  uploadBtnDone: {
    borderColor: colors.border.medium,
  },
  uploadBtnText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.caption,
    color: colors.primary[500],
  },
  submitWrap: {
    marginTop: spacing.s,
    gap: spacing.xs,
  },
  submitHint: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
