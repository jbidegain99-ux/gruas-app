import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { colors, typography } from '@/theme';

interface BudiLogoProps {
  variant?: 'full' | 'icon' | 'wordmark';
  width?: number;
  height?: number;
  color?: string;
}

function Isotipo({ size, primaryColor, accentColor }: {
  size: number;
  primaryColor: string;
  accentColor: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      {/* Rounded rectangle background */}
      <Rect
        x="4"
        y="4"
        width="56"
        height="56"
        rx="14"
        ry="14"
        fill={primaryColor}
      />
      {/* Letter B - main body */}
      <Path
        d="M20 14h14c5.5 0 10 4 10 9 0 3.5-2 6.5-5 8 4 1.5 7 5.5 7 10 0 6-5 10-11 10H20V14z
           M27 28h6c2.5 0 4.5-1.8 4.5-4.2S35.5 19.5 33 19.5h-6V28z
           M27 45.5h8c3 0 5.5-2.2 5.5-5S37 35.5 34 35.5h-7V45.5z"
        fill={colors.white}
      />
      {/* Location pin in negative space */}
      <Circle cx="44" cy="14" r="7" fill={accentColor} />
      <Circle cx="44" cy="13" r="3" fill={primaryColor} />
      <Path
        d="M44 22l-3-4.5h6L44 22z"
        fill={accentColor}
      />
    </Svg>
  );
}

export function BudiLogo({
  variant = 'full',
  width,
  height,
  color,
}: BudiLogoProps) {
  const primaryColor = color ?? colors.primary[500];
  const accentColor = color ? color : colors.accent[500];
  const iconSize = height ?? width ?? 48;

  if (variant === 'wordmark') {
    return (
      <Text
        style={[
          styles.wordmark,
          {
            color: primaryColor,
            fontSize: iconSize * 0.6,
            lineHeight: iconSize * 0.75,
          },
        ]}
      >
        Budi
      </Text>
    );
  }

  if (variant === 'icon') {
    return (
      <Isotipo
        size={iconSize}
        primaryColor={primaryColor}
        accentColor={accentColor}
      />
    );
  }

  // full variant
  const logoHeight = height ?? 48;
  const logoWidth = width ?? logoHeight * 3;

  return (
    <View style={[styles.fullContainer, { width: logoWidth, height: logoHeight }]}>
      <Isotipo
        size={logoHeight}
        primaryColor={primaryColor}
        accentColor={accentColor}
      />
      <Text
        style={[
          styles.wordmark,
          {
            color: primaryColor,
            fontSize: logoHeight * 0.5,
            lineHeight: logoHeight * 0.65,
            marginLeft: logoHeight * 0.2,
          },
        ]}
      >
        Budi
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fullContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wordmark: {
    fontFamily: typography.fonts.heading,
  },
});
