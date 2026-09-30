import { Alert, Platform } from 'react-native';

/**
 * Confirmación de dos botones que también funciona en web.
 *
 * En react-native-web `Alert.alert` con botones no hace nada: el toque se
 * perdía sin aviso (el socio no podía aceptar, salir en camino ni completar en
 * la app web). Mismo arreglo que OperatorCashCard y verification.tsx.
 */
export function confirmAction({
  title,
  message,
  confirmText,
  cancelText = 'Cancelar',
  destructive = false,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
}): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelText, style: 'cancel' },
    { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
