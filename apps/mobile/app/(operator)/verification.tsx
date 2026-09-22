import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { ChevronLeft, Check, Upload, ShieldCheck, Clock, ShieldX } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errorMessages';
import { Button, LoadingSpinner, ErrorState } from '@/shared/components/ui';
import { colors, typography, spacing, radii } from '@/theme';

type DocType = 'dui_front' | 'dui_back' | 'license' | 'circulation' | 'tow_photo' | 'insurance';

type DocConfig = {
  type: DocType;
  bucket: 'id-documents' | 'vehicle-documents';
  label: string;
  hint: string;
  required: boolean;
};

// Los buckets privados (id-documents / vehicle-documents) y su RLS ya existen
// (migración 00010). El path es `${uid}/<type>.jpg` para cumplir la política
// (foldername[1] === auth.uid()). Re-subir usa upsert:true → reemplaza.
const DOC_TYPES: DocConfig[] = [
  { type: 'dui_front', bucket: 'id-documents', label: 'DUI (frente)', hint: 'Foto clara del frente de tu DUI', required: true },
  { type: 'dui_back', bucket: 'id-documents', label: 'DUI (reverso)', hint: 'Foto clara del reverso de tu DUI', required: true },
  { type: 'license', bucket: 'id-documents', label: 'Licencia de conducir', hint: 'Licencia vigente (pesada si tu grúa es pesada)', required: true },
  { type: 'circulation', bucket: 'vehicle-documents', label: 'Tarjeta de circulación', hint: 'Tarjeta de circulación de la grúa', required: true },
  { type: 'tow_photo', bucket: 'vehicle-documents', label: 'Foto de la grúa', hint: 'Opcional. Foto del vehículo que usarás', required: false },
  { type: 'insurance', bucket: 'vehicle-documents', label: 'Póliza de seguro', hint: 'Opcional. Póliza vigente', required: false },
];

type DocState = { uploaded: boolean; uploading: boolean; localUri?: string };

export default function OperatorVerification() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<string>('pending');
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [docs, setDocs] = useState<Record<DocType, DocState>>(() =>
    DOC_TYPES.reduce((acc, d) => {
      acc[d.type] = { uploaded: false, uploading: false };
      return acc;
    }, {} as Record<DocType, DocState>)
  );

  const load = useCallback(async () => {
    setLoadError(false);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const [{ data: profile, error: pErr }, { data: docRows, error: dErr }] = await Promise.all([
      supabase
        .from('profiles')
        .select('verification_status, verification_submitted_at, verification_rejection_reason')
        .eq('id', user.id)
        .single(),
      supabase.from('operator_documents').select('doc_type').eq('operator_id', user.id),
    ]);

    if (pErr || dErr) {
      console.error('Error loading verification:', pErr || dErr);
      setLoadError(true);
      setLoading(false);
      return;
    }

    setStatus(profile?.verification_status || 'pending');
    setSubmittedAt(profile?.verification_submitted_at ?? null);
    setRejectionReason(profile?.verification_rejection_reason ?? null);

    const uploadedTypes = new Set((docRows || []).map((r) => r.doc_type as DocType));
    setDocs((prev) => {
      const next = { ...prev };
      DOC_TYPES.forEach((d) => {
        next[d.type] = { ...next[d.type], uploaded: uploadedTypes.has(d.type) };
      });
      return next;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const uploadImage = async (doc: DocConfig, uri: string) => {
    setDocs((p) => ({ ...p, [doc.type]: { ...p[doc.type], uploading: true } }));
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Sesión no válida');

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (!base64) throw new Error('No se pudo leer la imagen');

      const path = `${user.id}/${doc.type}.jpg`;
      const { error: upErr } = await supabase.storage
        .from(doc.bucket)
        .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: true });
      if (upErr) throw upErr;

      const { error: rpcErr } = await supabase.rpc('upsert_operator_document', {
        p_doc_type: doc.type,
        p_bucket: doc.bucket,
        p_path: path,
      });
      if (rpcErr) throw rpcErr;

      setDocs((p) => ({ ...p, [doc.type]: { uploaded: true, uploading: false, localUri: uri } }));
    } catch (err) {
      console.error('Upload error:', err);
      setDocs((p) => ({ ...p, [doc.type]: { ...p[doc.type], uploading: false } }));
      Alert.alert('Error', friendlyError(err as Error, 'No se pudo subir el documento. Intenta de nuevo.'));
    }
  };

  const pickFromLibrary = async (doc: DocConfig) => {
    const { status: perm } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm !== 'granted') {
      Alert.alert('Permisos', 'Se requiere acceso a la galería.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (!result.canceled && result.assets[0]) uploadImage(doc, result.assets[0].uri);
  };

  const takePhoto = async (doc: DocConfig) => {
    const { status: perm } = await ImagePicker.requestCameraPermissionsAsync();
    if (perm !== 'granted') {
      Alert.alert('Permisos', 'Se requiere acceso a la cámara.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!result.canceled && result.assets[0]) uploadImage(doc, result.assets[0].uri);
  };

  const chooseSource = (doc: DocConfig) => {
    Alert.alert(doc.label, '¿De dónde quieres subir el documento?', [
      { text: 'Cámara', onPress: () => takePhoto(doc) },
      { text: 'Galería', onPress: () => pickFromLibrary(doc) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const requiredUploaded = DOC_TYPES.filter((d) => d.required).every((d) => docs[d.type].uploaded);

  const handleSubmit = async () => {
    if (!requiredUploaded) {
      Alert.alert('Faltan documentos', 'Sube todos los documentos obligatorios antes de enviar.');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc('submit_operator_verification');
    setSubmitting(false);
    if (error) {
      Alert.alert('Error', friendlyError(error, 'No se pudo enviar a revisión. Intenta de nuevo.'));
      return;
    }
    Alert.alert(
      'Enviado a revisión',
      'Tus documentos fueron enviados. Un administrador los revisará y te avisaremos cuando tu cuenta esté aprobada.',
      [{ text: 'Entendido', onPress: () => router.back() }]
    );
  };

  if (loading) return <LoadingSpinner fullScreen />;

  if (loadError) {
    return (
      <ErrorState
        fullScreen
        offline
        title="No pudimos cargar la verificación"
        message="Revisa tu conexión e intenta de nuevo."
        onRetry={load}
      />
    );
  }

  const inReview = status === 'pending' && !!submittedAt;
  const approved = status === 'approved';
  const rejected = status === 'rejected';

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
        <Text style={styles.title}>Verificación</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Banner de estado */}
        {approved && (
          <View style={[styles.banner, { backgroundColor: colors.success.light, borderColor: colors.success.main }]}>
            <ShieldCheck size={20} color={colors.success.main} strokeWidth={2} />
            <Text style={[styles.bannerText, { color: colors.success.dark }]}>
              Tu cuenta está verificada. Puedes recibir solicitudes.
            </Text>
          </View>
        )}
        {inReview && (
          <View style={[styles.banner, { backgroundColor: colors.warning.light, borderColor: colors.warning.main }]}>
            <Clock size={20} color={colors.warning.dark} strokeWidth={2} />
            <Text style={[styles.bannerText, { color: colors.warning.dark }]}>
              Tus documentos están en revisión. Te avisaremos cuando tu cuenta esté aprobada.
            </Text>
          </View>
        )}
        {rejected && (
          <View style={[styles.banner, { backgroundColor: colors.error.light, borderColor: colors.error.main }]}>
            <ShieldX size={20} color={colors.error.main} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerText, { color: colors.error.dark }]}>
                Tu verificación fue rechazada.
              </Text>
              {rejectionReason ? (
                <Text style={styles.rejectionReason}>Motivo: {rejectionReason}</Text>
              ) : null}
              <Text style={styles.rejectionReason}>Corrige tus documentos y vuelve a enviar.</Text>
            </View>
          </View>
        )}

        {!approved && !inReview && (
          <Text style={styles.intro}>
            Sube los documentos requeridos para que un administrador verifique tu cuenta.
            Solo podrás recibir solicitudes una vez aprobado.
          </Text>
        )}

        {/* Lista de documentos */}
        {DOC_TYPES.map((doc) => {
          const state = docs[doc.type];
          return (
            <View key={doc.type} style={styles.docRow}>
              <View style={styles.docInfo}>
                <View style={styles.docLabelRow}>
                  <Text style={styles.docLabel}>{doc.label}</Text>
                  {doc.required ? (
                    <Text style={styles.requiredTag}>Obligatorio</Text>
                  ) : (
                    <Text style={styles.optionalTag}>Opcional</Text>
                  )}
                </View>
                <Text style={styles.docHint}>{doc.hint}</Text>
                {state.uploaded && (
                  <View style={styles.uploadedRow}>
                    <Check size={14} color={colors.success.main} strokeWidth={2.5} />
                    <Text style={styles.uploadedText}>Subido</Text>
                  </View>
                )}
              </View>

              {state.localUri ? (
                <Image source={{ uri: state.localUri }} style={styles.thumb} resizeMode="cover" />
              ) : null}

              <Pressable
                style={[styles.uploadBtn, state.uploaded && styles.uploadBtnDone]}
                onPress={() => chooseSource(doc)}
                disabled={state.uploading || approved || inReview}
                accessibilityRole="button"
                accessibilityLabel={`Subir ${doc.label}`}
              >
                {state.uploading ? (
                  <ActivityIndicator size="small" color={colors.primary[500]} />
                ) : (
                  <Upload size={16} color={state.uploaded ? colors.success.main : colors.primary[500]} strokeWidth={2} />
                )}
                <Text style={[styles.uploadBtnText, state.uploaded && { color: colors.success.main }]}>
                  {state.uploaded ? 'Cambiar' : 'Subir'}
                </Text>
              </Pressable>
            </View>
          );
        })}

        {!approved && !inReview && (
          <View style={styles.submitWrap}>
            <Button
              title="Enviar a revisión"
              onPress={handleSubmit}
              size="large"
              loading={submitting}
              disabled={submitting || !requiredUploaded}
            />
            {!requiredUploaded && (
              <Text style={styles.submitHint}>Sube todos los documentos obligatorios para continuar.</Text>
            )}
          </View>
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
  bannerText: {
    flex: 1,
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    lineHeight: 20,
  },
  rejectionReason: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    marginTop: spacing.micro,
  },
  intro: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    lineHeight: 20,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    padding: spacing.m,
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colors.border.light,
    backgroundColor: colors.background.secondary,
  },
  docInfo: {
    flex: 1,
  },
  docLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  docLabel: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
  },
  requiredTag: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.micro,
    color: colors.error.main,
  },
  optionalTag: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.micro,
    color: colors.text.tertiary,
  },
  docHint: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    marginTop: spacing.micro,
  },
  uploadedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.micro,
    marginTop: spacing.xs,
  },
  uploadedText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.success.main,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: radii.s,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.s,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.primary[500],
  },
  uploadBtnDone: {
    borderColor: colors.success.main,
  },
  uploadBtnText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.caption,
    color: colors.primary[500],
  },
  submitWrap: {
    marginTop: spacing.m,
    gap: spacing.xs,
  },
  submitHint: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
    textAlign: 'center',
  },
});
