import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  Animated,
  TextInputProps,
} from 'react-native';
import { colors, typography, spacing, radii, durations } from '@/theme';

type InputVariant = 'default' | 'search';

interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  success?: boolean;
  disabled?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  variant?: InputVariant;
}

export function Input({
  label,
  error,
  success = false,
  disabled = false,
  leftIcon,
  rightIcon,
  variant = 'default',
  ...textInputProps
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const focusAnim = useRef(new Animated.Value(0)).current;

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    Animated.timing(focusAnim, {
      toValue: 1,
      duration: durations.normal,
      useNativeDriver: false,
    }).start();
  }, [focusAnim]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    Animated.timing(focusAnim, {
      toValue: 0,
      duration: durations.normal,
      useNativeDriver: false,
    }).start();
  }, [focusAnim]);

  const borderColor = error
    ? colors.border.error
    : success
      ? colors.border.success
      : undefined;

  const animatedBorderColor = borderColor
    ? borderColor
    : focusAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [colors.border.light, colors.border.focus],
      });

  const isSearch = variant === 'search';

  return (
    <View style={[styles.container, disabled && styles.disabled]}>
      {label && !isSearch && (
        <Text style={styles.label}>{label}</Text>
      )}
      <Animated.View
        style={[
          styles.inputContainer,
          isSearch && styles.searchContainer,
          { borderColor: animatedBorderColor },
        ]}
      >
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        <TextInput
          {...textInputProps}
          editable={!disabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[
            styles.input,
            leftIcon ? styles.inputWithLeftIcon : undefined,
            rightIcon ? styles.inputWithRightIcon : undefined,
          ]}
          placeholderTextColor={colors.text.tertiary}
        />
        {rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
      </Animated.View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radii.m,
    backgroundColor: colors.background.primary,
    minHeight: 48,
  },
  searchContainer: {
    borderRadius: radii.full,
    backgroundColor: colors.background.secondary,
  },
  input: {
    flex: 1,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
  inputWithLeftIcon: {
    paddingLeft: spacing.xs,
  },
  inputWithRightIcon: {
    paddingRight: spacing.xs,
  },
  leftIcon: {
    paddingLeft: spacing.m,
  },
  rightIcon: {
    paddingRight: spacing.m,
  },
  errorText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.error.main,
    marginTop: spacing.micro,
  },
});
