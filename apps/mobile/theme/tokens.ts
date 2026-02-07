// Budi Design System - Design Tokens

export const colors = {
  // Brand
  primary: {
    50: '#E8F0F7',
    100: '#C5D9EB',
    200: '#9FC0DE',
    300: '#78A6D0',
    400: '#5B93C6',
    500: '#2D5F8B',
    600: '#275580',
    700: '#1F4768',
    800: '#183951',
    900: '#0F2639',
  },
  accent: {
    50: '#FEF4E8',
    100: '#FCE3C5',
    200: '#FACF9E',
    300: '#F8BB77',
    400: '#F5A25B',
    500: '#F5A25B',
    600: '#E08A3E',
    700: '#C47530',
    800: '#A86024',
    900: '#7A4218',
  },

  // Semantic
  success: {
    light: '#E8F5E9',
    main: '#2ECC71',
    dark: '#27AE60',
  },
  error: {
    light: '#FFEBEE',
    main: '#E74C3C',
    dark: '#C0392B',
  },
  warning: {
    light: '#FFF8E1',
    main: '#F39C12',
    dark: '#D68910',
  },
  info: {
    light: '#E3F2FD',
    main: '#3498DB',
    dark: '#2980B9',
  },

  // Text hierarchy
  text: {
    primary: '#1A1A2E',
    secondary: '#6B7280',
    tertiary: '#9CA3AF',
    inverse: '#FFFFFF',
    link: '#2D5F8B',
  },

  // Backgrounds
  background: {
    primary: '#FFFFFF',
    secondary: '#F8F9FB',
    tertiary: '#F0F2F5',
    overlay: 'rgba(0, 0, 0, 0.5)',
  },

  // Borders
  border: {
    light: '#E5E7EB',
    medium: '#D1D5DB',
    dark: '#9CA3AF',
    focus: '#2D5F8B',
    error: '#E74C3C',
    success: '#2ECC71',
  },

  // Status badge colors
  status: {
    initiated: { bg: '#FFF8E1', text: '#D68910', dot: '#F39C12' },
    assigned: { bg: '#E3F2FD', text: '#2980B9', dot: '#3498DB' },
    en_route: { bg: '#E8F0F7', text: '#275580', dot: '#2D5F8B' },
    active: { bg: '#FEF4E8', text: '#C47530', dot: '#F5A25B' },
    completed: { bg: '#E8F5E9', text: '#27AE60', dot: '#2ECC71' },
    cancelled: { bg: '#FFEBEE', text: '#C0392B', dot: '#E74C3C' },
  },

  // Misc
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

export const typography = {
  fonts: {
    heading: 'PlusJakartaSans_700Bold',
    headingMedium: 'PlusJakartaSans_500Medium',
    headingExtra: 'PlusJakartaSans_800ExtraBold',
    body: 'Inter_400Regular',
    bodyMedium: 'Inter_500Medium',
    bodySemiBold: 'Inter_600SemiBold',
    bodyBold: 'Inter_700Bold',
    bodyExtra: 'Inter_800ExtraBold',
  },
  sizes: {
    hero: 32,
    h1: 28,
    h2: 24,
    h3: 20,
    h4: 18,
    body: 16,
    bodySmall: 14,
    caption: 12,
    micro: 10,
  },
  lineHeights: {
    hero: 40,
    h1: 36,
    h2: 32,
    h3: 28,
    h4: 24,
    body: 24,
    bodySmall: 20,
    caption: 16,
    micro: 14,
  },
} as const;

export const spacing = {
  micro: 4,
  xs: 8,
  s: 12,
  m: 16,
  l: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  xxxxl: 64,
} as const;

export const radii = {
  s: 8,
  m: 12,
  l: 16,
  xl: 20,
  xxl: 24,
  full: 999,
} as const;

export const shadows = {
  small: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  large: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

export const touchTargets = {
  primary: 56,
  secondary: 48,
  tertiary: 44,
  icon: 50,
} as const;

export const durations = {
  fast: 150,
  normal: 250,
  slow: 350,
} as const;
