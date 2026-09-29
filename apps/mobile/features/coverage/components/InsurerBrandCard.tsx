import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { brandLogoUrl, brandTextColor, parseBrand, type InsurerBrand } from '@/lib/brand';
import { colors, typography, spacing, radii } from '@/theme';

/**
 * ASE-05 (00135): "Asistencia Vial XYZ, con tecnología Budi". Solo para el
 * afiliado con póliza vigente cuya aseguradora activó su marca; para todos los
 * demás no se muestra nada.
 */
export function InsurerBrandCard() {
  const [brand, setBrand] = useState<InsurerBrand | null>(null);

  useFocusEffect(
    useCallback(() => {
      supabase.rpc('my_insurer_branding').then(({ data, error }) => setBrand(error ? null : parseBrand(data)));
    }, []),
  );

  if (!brand) return null;
  const accent = brand.color ?? colors.primary[500];
  const logo = brandLogoUrl(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '', brand.logo_path);

  return (
    <View style={styles.card} accessibilityLabel={`${brand.brand_name}, con tecnología Budi`}>
      <View style={[styles.strip, { backgroundColor: accent }]} />
      <View style={styles.body}>
        {logo ? (
          <Image source={{ uri: logo }} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.logo, styles.iconBox, { backgroundColor: accent }]}>
            <ShieldCheck size={20} color={brandTextColor(accent)} strokeWidth={2} />
          </View>
        )}
        <View style={styles.texts}>
          <Text style={styles.name} numberOfLines={1}>{brand.brand_name}</Text>
          <Text style={styles.powered}>con tecnología Budi</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.m,
    borderRadius: radii.m,
    backgroundColor: colors.background.primary,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border.light,
  },
  strip: { height: 5 },
  body: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, padding: spacing.s },
  logo: { width: 44, height: 44, borderRadius: radii.s },
  iconBox: { alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1 },
  name: { fontFamily: typography.fonts.bodySemiBold, fontSize: typography.sizes.body, color: colors.text.primary },
  powered: { fontFamily: typography.fonts.body, fontSize: typography.sizes.caption, color: colors.text.secondary },
});
