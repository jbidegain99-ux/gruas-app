import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { FileDown } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from '@/lib/supabase';
import { toast } from '@/shared/components/ui';
import { colors, spacing, typography } from '@/theme';

/**
 * "Descargar mis datos" (migr. 00139, LAN-01 / Decreto 144, derecho de acceso).
 * Arma un .json con todo lo que Budi guarda de la persona y lo abre en el menú
 * de compartir del teléfono (guardar en Archivos, mandarlo por correo…). En la
 * web se descarga directo.
 */
export function ExportDataRow() {
  const [busy, setBusy] = useState(false);

  const exportData = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('export_my_data');
      if (error || !data) throw error ?? new Error('Sin datos');
      const json = JSON.stringify(data, null, 2);
      const name = `mis-datos-budi-${new Date().toISOString().slice(0, 10)}.json`;

      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const uri = `${FileSystem.cacheDirectory}${name}`;
        await FileSystem.writeAsStringAsync(uri, json);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Tus datos en Budi' });
        } else {
          toast.info('Tu copia quedó guardada en el teléfono, pero este dispositivo no permite compartir archivos.');
          return;
        }
      }
      toast.success('Tu copia de datos está lista.');
    } catch {
      toast.error('No se pudo preparar tu copia de datos. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      style={styles.row}
      onPress={exportData}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Descargar mis datos"
    >
      {busy ? <ActivityIndicator size="small" color={colors.primary[500]} /> : <FileDown size={18} color={colors.primary[500]} />}
      <Text style={styles.rowText}>Descargar mis datos</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, paddingVertical: spacing.s },
  rowText: { fontFamily: typography.fonts.bodyMedium, fontSize: typography.sizes.body, color: colors.primary[500] },
});
