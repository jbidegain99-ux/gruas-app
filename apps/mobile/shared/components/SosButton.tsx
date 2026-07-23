// Botón de emergencia (SOS) para asistencia vial. Abre acciones rápidas:
// llamar a emergencias, llamar a soporte Budi, o compartir la ubicación actual.
import React, { useState } from 'react';
import { Pressable, Text, StyleSheet, Alert, Linking, Share, Platform } from 'react-native';
import * as Location from 'expo-location';
import { SUPPORT_CONFIG } from '@/config/support';
import { colors, typography, radii, spacing } from '@/theme';

async function shareMyLocation() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Ubicación', 'Necesitamos permiso de ubicación para compartirla.');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const { latitude, longitude } = loc.coords;
    const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
    await Share.share({
      message: `Necesito asistencia. Mi ubicación: ${mapsUrl}`,
    });
  } catch {
    Alert.alert('Ubicación', 'No se pudo obtener tu ubicación.');
  }
}

export function SosButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);

  const openMenu = () => {
    Alert.alert(
      'Emergencia',
      '¿Qué necesitas?',
      [
        {
          text: `Llamar a emergencias (${SUPPORT_CONFIG.EMERGENCY_NUMBER})`,
          onPress: () => Linking.openURL(`tel:${SUPPORT_CONFIG.EMERGENCY_NUMBER}`),
        },
        {
          text: 'Llamar a soporte Budi',
          onPress: () => Linking.openURL(`tel:${SUPPORT_CONFIG.SUPPORT_PHONE}`),
        },
        {
          text: 'Compartir mi ubicación',
          onPress: async () => {
            setBusy(true);
            await shareMyLocation();
            setBusy(false);
          },
        },
        { text: 'Cancelar', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  return (
    <Pressable
      onPress={openMenu}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Emergencia"
      style={({ pressed }) => [
        compact ? styles.compact : styles.full,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={compact ? styles.compactText : styles.fullText}>SOS</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.error.main,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: colors.error.main,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.35,
        shadowRadius: 4,
      },
    }),
  },
  compactText: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.bodySmall,
    color: colors.white,
    letterSpacing: 0.5,
  },
  full: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error.main,
    paddingVertical: spacing.m,
    borderRadius: radii.l,
  },
  fullText: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h4,
    color: colors.white,
    letterSpacing: 1,
  },
});
