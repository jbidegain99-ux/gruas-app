import { View, Text, StyleSheet } from 'react-native';
import { AlertCircle, WifiOff } from 'lucide-react-native';
import { Button } from './Button';
import { colors, typography, spacing } from '@/theme';

type ErrorStateProps = {
  /** Título corto. Por defecto "Algo salió mal". */
  title?: string;
  /** Mensaje explicativo para el usuario. */
  message?: string;
  /** Acción de reintento. Si se omite, no se muestra el botón. */
  onRetry?: () => void;
  /** Texto del botón de reintento. */
  retryLabel?: string;
  /** Usa el ícono de "sin conexión" en lugar del genérico. */
  offline?: boolean;
  /** Ocupa toda la pantalla y centra el contenido. */
  fullScreen?: boolean;
};

/**
 * Estado de error consistente para pantallas con carga de datos.
 * Reemplaza el patrón de "pantalla vacía silenciosa" cuando un fetch falla:
 * comunica el problema y ofrece reintentar. Ver profile.tsx como referencia.
 */
export function ErrorState({
  title = 'Algo salió mal',
  message = 'No pudimos cargar la información. Revisa tu conexión e intenta de nuevo.',
  onRetry,
  retryLabel = 'Reintentar',
  offline = false,
  fullScreen = false,
}: ErrorStateProps) {
  const Icon = offline ? WifiOff : AlertCircle;
  return (
    <View style={[styles.container, fullScreen && styles.fullScreen]}>
      <Icon size={48} color={colors.error.main} strokeWidth={1.5} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <View style={styles.button}>
          <Button title={retryLabel} onPress={onRetry} size="medium" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.s,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  title: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
    textAlign: 'center',
  },
  message: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    marginTop: spacing.s,
    minWidth: 160,
  },
});
