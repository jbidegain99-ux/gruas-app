import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { confirmAction } from '@/lib/confirm';
import { ToastHost, toast } from '@/shared/components/ui';
import { colors, typography, spacing, radii } from '@/theme';

interface RatingModalProps {
  visible: boolean;
  requestId: string;
  operatorName: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}

const STARS = [1, 2, 3, 4, 5];

export function RatingModal({
  visible,
  requestId,
  operatorName,
  onClose,
  onSubmitted,
}: RatingModalProps) {
  const [selectedStars, setSelectedStars] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reinicia el estado cada vez que se abre, para no arrastrar la calificación
  // ni el comentario de un servicio anterior.
  useEffect(() => {
    if (visible) {
      setSelectedStars(0);
      setComment('');
    }
  }, [visible]);

  const handleSubmit = async () => {
    if (selectedStars === 0) {
      toast.error('Selecciona de 1 a 5 estrellas.', 'Selecciona una calificación');
      return;
    }

    setSubmitting(true);

    try {
      const { error } = await supabase.rpc('rate_service', {
        p_request_id: requestId,
        p_stars: selectedStars,
        p_comment: comment.trim() || null,
      });

      if (error) {
        console.error('Rating error:', error);
        toast.error('No se pudo enviar la calificación. Intenta de nuevo.');
        setSubmitting(false);
        return;
      }

      // El toast queda visible en la raíz después de cerrar el modal.
      toast.success('Tu calificación fue enviada.', '¡Gracias!');
      onSubmitted();
    } catch (err) {
      console.error('Rating exception:', err);
      toast.error('Error de conexión. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    confirmAction({
      title: 'Omitir calificación',
      message: '¿Estás seguro de que no deseas calificar el servicio?',
      confirmText: 'Omitir',
      onConfirm: onClose,
    });
  };

  const getStarLabel = () => {
    switch (selectedStars) {
      case 1: return 'Muy malo';
      case 2: return 'Malo';
      case 3: return 'Regular';
      case 4: return 'Bueno';
      case 5: return 'Excelente';
      default: return 'Toca para calificar';
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleSkip}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Califica el servicio</Text>

          {operatorName && (
            <Text style={styles.operatorName}>Socio operador: {operatorName}</Text>
          )}

          <View style={styles.starsContainer}>
            {STARS.map((star) => (
              <TouchableOpacity
                key={star}
                onPress={() => setSelectedStars(star)}
                style={styles.starButton}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={`Calificar con ${star} ${star === 1 ? 'estrella' : 'estrellas'}`}
                accessibilityState={{ selected: star <= selectedStars }}
              >
                <Text
                  style={[
                    styles.star,
                    star <= selectedStars && styles.starSelected,
                  ]}
                >
                  ★
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[
            styles.starLabel,
            selectedStars > 0 && styles.starLabelSelected,
          ]}>
            {getStarLabel()}
          </Text>

          <TextInput
            style={styles.commentInput}
            placeholder="Comentario opcional..."
            maxLength={500}
            placeholderTextColor={colors.text.tertiary}
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            editable={!submitting}
          />

          <View style={styles.buttons}>
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
              disabled={submitting}
            >
              <Text style={styles.skipButtonText}>Omitir</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.submitButton,
                selectedStars === 0 && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={submitting || selectedStars === 0}
            >
              {submitting ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.submitButtonText}>Enviar</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
        {/* Los toasts se pintan sobre el Modal nativo, no detrás. */}
        <ToastHost />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.background.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.l,
  },
  modal: {
    backgroundColor: colors.background.primary,
    borderRadius: radii.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  title: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  operatorName: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginBottom: spacing.l,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  starButton: {
    padding: spacing.micro,
  },
  star: {
    fontSize: 40,
    color: colors.border.light,
  },
  starSelected: {
    color: colors.warning.main,
  },
  starLabel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.tertiary,
    marginBottom: spacing.l,
  },
  starLabelSelected: {
    fontFamily: typography.fonts.bodyMedium,
    color: colors.text.primary,
  },
  commentInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border.light,
    borderRadius: radii.m,
    padding: spacing.s,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
    minHeight: 80,
    backgroundColor: colors.background.secondary,
    marginBottom: spacing.l,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.s,
    width: '100%',
  },
  skipButton: {
    flex: 1,
    paddingVertical: spacing.m,
    borderRadius: radii.m,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border.medium,
    backgroundColor: colors.background.primary,
  },
  skipButtonText: {
    fontFamily: typography.fonts.bodySemiBold,
    color: colors.text.secondary,
    fontSize: typography.sizes.body,
  },
  submitButton: {
    flex: 1,
    paddingVertical: spacing.m,
    borderRadius: radii.m,
    alignItems: 'center',
    backgroundColor: colors.success.main,
  },
  submitButtonDisabled: {
    backgroundColor: colors.text.tertiary,
  },
  submitButtonText: {
    fontFamily: typography.fonts.bodySemiBold,
    color: colors.white,
    fontSize: typography.sizes.body,
  },
});
