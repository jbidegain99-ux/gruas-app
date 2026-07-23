import { Alert, Linking } from 'react-native';
import { SUPPORT_CONFIG } from '@/config/support';

// Menú de contacto de soporte, reutilizable desde cualquier pantalla.
export function openSupportMenu() {
  Alert.alert(
    'Ayuda y soporte',
    '¿Cómo prefieres contactarnos?',
    [
      {
        text: 'WhatsApp',
        onPress: () =>
          Linking.openURL(
            `https://wa.me/${SUPPORT_CONFIG.SUPPORT_WHATSAPP}?text=${encodeURIComponent(
              'Hola, necesito ayuda con Budi.'
            )}`
          ),
      },
      {
        text: 'Llamar a soporte',
        onPress: () => Linking.openURL(`tel:${SUPPORT_CONFIG.SUPPORT_PHONE}`),
      },
      { text: 'Cancelar', style: 'cancel' },
    ],
    { cancelable: true }
  );
}
