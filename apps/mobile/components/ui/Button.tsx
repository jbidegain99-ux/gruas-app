import React, { useCallback, useRef } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  Animated,
} from 'react-native';
import { colors, typography, spacing, radii, touchTargets } from '@/theme';

type ButtonVariant = 'primary' | 'secondary' | 'tertiary';
type ButtonSize = 'large' | 'medium' | 'small';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

const sizeConfig: Record<ButtonSize, { height: number; fontSize: number; paddingH: number }> = {
  large: { height: touchTargets.primary, fontSize: typography.sizes.body, paddingH: spacing.xl },
  medium: { height: touchTargets.secondary, fontSize: typography.sizes.bodySmall, paddingH: spacing.l },
  small: { height: touchTargets.tertiary, fontSize: typography.sizes.caption, paddingH: spacing.m },
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'large',
  disabled = false,
  loading = false,
  icon,
  fullWidth = true,
}: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const config = sizeConfig[size];

  const handlePressIn = useCallback(() => {
    Animated.spring(scale, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scale]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scale]);

  const isDisabled = disabled || loading;

  const containerStyle = [
    styles.base,
    { height: config.height, paddingHorizontal: config.paddingH },
    variant === 'primary' && styles.primary,
    variant === 'secondary' && styles.secondary,
    variant === 'tertiary' && styles.tertiary,
    fullWidth && styles.fullWidth,
    isDisabled && styles.disabled,
    { transform: [{ scale }] },
  ];

  const textColor =
    variant === 'primary' ? colors.white : colors.primary[500];

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isDisabled}
      style={containerStyle}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
    >
      {loading ? (
        <ActivityIndicator
          color={textColor}
          size="small"
        />
      ) : (
        <View style={styles.content}>
          {icon && <View style={styles.icon}>{icon}</View>}
          <Text
            style={[
              styles.text,
              { fontSize: config.fontSize, color: textColor },
              variant === 'tertiary' && styles.tertiaryText,
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.m,
  },
  primary: {
    backgroundColor: colors.primary[500],
  },
  secondary: {
    backgroundColor: colors.transparent,
    borderWidth: 1.5,
    borderColor: colors.primary[500],
  },
  tertiary: {
    backgroundColor: colors.transparent,
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  icon: {
    marginRight: spacing.micro,
  },
  text: {
    fontFamily: typography.fonts.bodySemiBold,
  },
  tertiaryText: {
    fontFamily: typography.fonts.bodyMedium,
  },
});
