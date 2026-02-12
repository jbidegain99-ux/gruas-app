import { useState, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { colors, typography, spacing, radii } from '@/theme';

interface PINInputProps {
  value: string;
  onChangeText: (value: string) => void;
  /** Display-only mode (shows PIN without editing) */
  displayOnly?: boolean;
  /** Error message to show below input */
  error?: string;
  /** Number of digits */
  length?: number;
}

export function PINInput({
  value,
  onChangeText,
  displayOnly = false,
  error,
  length = 4,
}: PINInputProps) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const inputRefs = useRef<Array<TextInput | null>>([]);

  const digits = value.split('').slice(0, length);
  while (digits.length < length) {
    digits.push('');
  }

  const handleDigitChange = useCallback((text: string, index: number) => {
    // Only allow single numeric digit
    const digit = text.replace(/[^0-9]/g, '').slice(-1);

    const newDigits = value.split('').slice(0, length);
    while (newDigits.length < length) {
      newDigits.push('');
    }

    newDigits[index] = digit;
    const newValue = newDigits.join('').replace(/ /g, '');
    onChangeText(newValue);

    // Auto-advance to next input
    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }, [value, length, onChangeText]);

  const handleKeyPress = useCallback((index: number, key: string) => {
    // Handle backspace - go to previous input
    if (key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newDigits = [...digits];
      newDigits[index - 1] = '';
      onChangeText(newDigits.join(''));
    }
  }, [digits, onChangeText]);

  const handleFocus = useCallback((index: number) => {
    setFocusedIndex(index);
  }, []);

  const handleBlur = useCallback(() => {
    setFocusedIndex(null);
  }, []);

  // Display-only mode: just show the PIN digits
  if (displayOnly) {
    return (
      <View style={styles.container}>
        <View style={styles.digitsRow}>
          {digits.map((digit, index) => (
            <View key={index} style={styles.displayDigitBox}>
              <Text style={styles.displayDigitText}>
                {digit || '-'}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.digitsRow}>
        {digits.map((digit, index) => (
          <Pressable
            key={index}
            onPress={() => inputRefs.current[index]?.focus()}
            style={[
              styles.digitBox,
              focusedIndex === index && styles.digitBoxFocused,
              error ? styles.digitBoxError : undefined,
            ]}
          >
            <TextInput
              ref={(ref) => { inputRefs.current[index] = ref; }}
              style={styles.digitInput}
              value={digit}
              onChangeText={(text) => handleDigitChange(text, index)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent.key)}
              onFocus={() => handleFocus(index)}
              onBlur={handleBlur}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              caretHidden
            />
          </Pressable>
        ))}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const DIGIT_SIZE = 56;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  digitsRow: {
    flexDirection: 'row',
    gap: spacing.m,
    justifyContent: 'center',
  },
  // Editable digit box
  digitBox: {
    width: DIGIT_SIZE,
    height: DIGIT_SIZE + 8,
    borderRadius: radii.m,
    borderWidth: 2,
    borderColor: colors.border.light,
    backgroundColor: colors.background.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  digitBoxFocused: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  digitBoxError: {
    borderColor: colors.error.main,
  },
  digitInput: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h1,
    color: colors.text.primary,
    textAlign: 'center',
    width: '100%',
    height: '100%',
    padding: 0,
  },
  // Display-only digit box
  displayDigitBox: {
    width: DIGIT_SIZE,
    height: DIGIT_SIZE + 8,
    borderRadius: radii.m,
    backgroundColor: colors.accent[50],
    borderWidth: 2,
    borderColor: colors.accent[500],
    justifyContent: 'center',
    alignItems: 'center',
  },
  displayDigitText: {
    fontFamily: typography.fonts.headingExtra,
    fontSize: typography.sizes.hero,
    color: colors.accent[700],
  },
  errorText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.error.main,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
