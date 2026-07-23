import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { supabase } from '@/lib/supabase';

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

  const handleSubmit = async () => {
    if (selectedStars === 0) {
      Alert.alert('Selecciona una calificación', 'Por favor selecciona de 1 a 5 estrellas');
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
        Alert.alert('Error', 'No se pudo enviar la calificación. Intenta de nuevo.');
        setSubmitting(false);
        return;
      }

      Alert.alert(
        'Gracias',
        'Tu calificación ha sido enviada.',
        [{ text: 'OK', onPress: onSubmitted }]
      );
    } catch (err) {
      console.error('Rating exception:', err);
      Alert.alert('Error', 'Error de conexión. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    Alert.alert(
      'Omitir calificación',
      '¿Estás seguro de que no deseas calificar el servicio?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Omitir', onPress: onClose },
      ]
    );
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
            <Text style={styles.operatorName}>Operador: {operatorName}</Text>
          )}

          <View style={styles.starsContainer}>
            {STARS.map((star) => (
              <TouchableOpacity
                key={star}
                onPress={() => setSelectedStars(star)}
                style={styles.starButton}
                disabled={submitting}
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
            placeholderTextColor="#9ca3af"
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
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>Enviar</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  operatorName: {
    fontSize: 15,
    color: '#6b7280',
    marginBottom: 20,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  starButton: {
    padding: 4,
  },
  star: {
    fontSize: 40,
    color: '#e5e7eb',
  },
  starSelected: {
    color: '#fbbf24',
  },
  starLabel: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 20,
  },
  starLabelSelected: {
    color: '#111827',
    fontWeight: '500',
  },
  commentInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    minHeight: 80,
    backgroundColor: '#f9fafb',
    marginBottom: 20,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  skipButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  skipButtonText: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '600',
  },
  submitButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#16a34a',
  },
  submitButtonDisabled: {
    backgroundColor: '#9ca3af',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
