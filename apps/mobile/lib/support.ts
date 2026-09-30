import { Alert, Linking, Platform, type AlertButton } from 'react-native';
import { SUPPORT_CONFIG } from '@/config/support';
import { toast } from '@/shared/components/ui';

// Menú de contacto de soporte, reutilizable desde cualquier pantalla. Solo
// ofrece los canales que tienen un número configurado (APP-07).
export function openSupportMenu() {
  const opciones: AlertButton[] = [];
  if (SUPPORT_CONFIG.SUPPORT_WHATSAPP) {
    opciones.push({
      text: 'WhatsApp',
      onPress: () =>
        Linking.openURL(
          `https://wa.me/${SUPPORT_CONFIG.SUPPORT_WHATSAPP}?text=${encodeURIComponent('Hola, necesito ayuda con Budi.')}`
        ),
    });
  }
  if (SUPPORT_CONFIG.SUPPORT_PHONE) {
    opciones.push({ text: 'Llamar a soporte', onPress: () => Linking.openURL(`tel:${SUPPORT_CONFIG.SUPPORT_PHONE}`) });
  }

  if (opciones.length === 0) {
    toast.info('La línea de soporte todavía no está disponible. Si es una emergencia, llama al 911.', 'Ayuda y soporte');
    return;
  }

  // En web Alert.alert con botones no hace nada: se abre directo el primer
  // canal disponible (WhatsApp si está configurado, si no la llamada).
  if (Platform.OS === 'web') {
    opciones[0].onPress?.();
    return;
  }

  Alert.alert('Ayuda y soporte', '¿Cómo prefieres contactarnos?', [...opciones, { text: 'Cancelar', style: 'cancel' }], {
    cancelable: true,
  });
}
