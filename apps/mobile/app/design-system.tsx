import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { Search } from 'lucide-react-native';
import type { ServiceRequestStatus } from '@gruas-app/shared';
import { colors, typography, spacing, radii } from '@/theme';
import {
  BudiLogo,
  Button,
  Input,
  Card,
  StatusBadge,
  LoadingSpinner,
} from '@/components/ui';

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function SubTitle({ title }: { title: string }) {
  return <Text style={styles.subTitle}>{title}</Text>;
}

function ColorSwatch({ name, color }: { name: string; color: string }) {
  return (
    <View style={styles.swatchContainer}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.swatchLabel}>{name}</Text>
      <Text style={styles.swatchValue}>{color}</Text>
    </View>
  );
}

const ALL_STATUSES: ServiceRequestStatus[] = [
  'initiated',
  'assigned',
  'en_route',
  'active',
  'completed',
  'cancelled',
];

export default function DesignSystemScreen() {
  const [inputValue, setInputValue] = useState('');
  const [searchValue, setSearchValue] = useState('');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      {/* Logo */}
      <SectionTitle title="Logo" />
      <View style={styles.row}>
        <SubTitle title="Full" />
        <BudiLogo variant="full" height={48} />
      </View>
      <View style={styles.row}>
        <SubTitle title="Icon" />
        <BudiLogo variant="icon" height={48} />
      </View>
      <View style={styles.row}>
        <SubTitle title="Wordmark" />
        <BudiLogo variant="wordmark" height={48} />
      </View>

      {/* Color Palette */}
      <SectionTitle title="Colores" />
      <SubTitle title="Brand" />
      <View style={styles.swatchRow}>
        <ColorSwatch name="Primary" color={colors.primary[500]} />
        <ColorSwatch name="Accent" color={colors.accent[500]} />
      </View>
      <SubTitle title="Semantic" />
      <View style={styles.swatchRow}>
        <ColorSwatch name="Success" color={colors.success.main} />
        <ColorSwatch name="Error" color={colors.error.main} />
        <ColorSwatch name="Warning" color={colors.warning.main} />
        <ColorSwatch name="Info" color={colors.info.main} />
      </View>
      <SubTitle title="Primary Scale" />
      <View style={styles.swatchRow}>
        <ColorSwatch name="50" color={colors.primary[50]} />
        <ColorSwatch name="100" color={colors.primary[100]} />
        <ColorSwatch name="300" color={colors.primary[300]} />
        <ColorSwatch name="500" color={colors.primary[500]} />
        <ColorSwatch name="700" color={colors.primary[700]} />
        <ColorSwatch name="900" color={colors.primary[900]} />
      </View>

      {/* Typography */}
      <SectionTitle title="Tipografia" />
      <Text style={styles.hero}>Hero (32px)</Text>
      <Text style={styles.h1}>Heading 1 (28px)</Text>
      <Text style={styles.h2}>Heading 2 (24px)</Text>
      <Text style={styles.h3}>Heading 3 (20px)</Text>
      <Text style={styles.h4}>Heading 4 (18px)</Text>
      <Text style={styles.body}>Body Regular (16px)</Text>
      <Text style={styles.bodyMedium}>Body Medium (16px)</Text>
      <Text style={styles.bodySemiBold}>Body SemiBold (16px)</Text>
      <Text style={styles.bodySmall}>Body Small (14px)</Text>
      <Text style={styles.caption}>Caption (12px)</Text>

      {/* Buttons */}
      <SectionTitle title="Botones" />
      <SubTitle title="Primary" />
      <View style={styles.buttonGroup}>
        <Button title="Primary Button" onPress={() => {}} />
        <Button title="Disabled" onPress={() => {}} disabled />
        <Button title="Loading..." onPress={() => {}} loading />
      </View>

      <SubTitle title="Secondary" />
      <View style={styles.buttonGroup}>
        <Button title="Secondary Button" onPress={() => {}} variant="secondary" />
        <Button title="Disabled" onPress={() => {}} variant="secondary" disabled />
        <Button title="Loading..." onPress={() => {}} variant="secondary" loading />
      </View>

      <SubTitle title="Tertiary" />
      <View style={styles.buttonGroup}>
        <Button title="Tertiary Button" onPress={() => {}} variant="tertiary" />
        <Button title="Disabled" onPress={() => {}} variant="tertiary" disabled />
      </View>

      <SubTitle title="Sizes" />
      <View style={styles.buttonGroup}>
        <Button title="Large (56px)" onPress={() => {}} size="large" />
        <Button title="Medium (48px)" onPress={() => {}} size="medium" />
        <Button title="Small (44px)" onPress={() => {}} size="small" />
      </View>

      {/* Inputs */}
      <SectionTitle title="Inputs" />
      <View style={styles.inputGroup}>
        <Input
          label="Default"
          placeholder="Enter text..."
          value={inputValue}
          onChangeText={setInputValue}
        />
        <Input
          label="With Error"
          placeholder="Enter email..."
          value="invalid-email"
          error="Email no valido"
        />
        <Input
          label="Success"
          placeholder="Enter name..."
          value="Jose"
          success
        />
        <Input
          label="Disabled"
          placeholder="Can't edit..."
          disabled
        />
        <Input
          variant="search"
          placeholder="Buscar..."
          value={searchValue}
          onChangeText={setSearchValue}
          leftIcon={<Search size={20} color={colors.text.tertiary} />}
        />
      </View>

      {/* Cards */}
      <SectionTitle title="Cards" />
      <View style={styles.cardGroup}>
        <Card variant="default">
          <Text style={styles.cardTitle}>Default Card</Text>
          <Text style={styles.cardBody}>Shadow small, border-radius 16px</Text>
        </Card>
        <Card variant="elevated">
          <Text style={styles.cardTitle}>Elevated Card</Text>
          <Text style={styles.cardBody}>Shadow medium, mas prominente</Text>
        </Card>
        <Card variant="outlined">
          <Text style={styles.cardTitle}>Outlined Card</Text>
          <Text style={styles.cardBody}>Border light, sin shadow</Text>
        </Card>
        <Card variant="elevated" onPress={() => {}}>
          <Text style={styles.cardTitle}>Pressable Card</Text>
          <Text style={styles.cardBody}>Presiona para ver animacion</Text>
        </Card>
      </View>

      {/* Status Badges */}
      <SectionTitle title="Status Badges" />
      <View style={styles.badgeGroup}>
        {ALL_STATUSES.map((status) => (
          <StatusBadge key={status} status={status} />
        ))}
      </View>
      <SubTitle title="Small" />
      <View style={styles.badgeGroup}>
        {ALL_STATUSES.map((status) => (
          <StatusBadge key={status} status={status} size="small" />
        ))}
      </View>

      {/* Loading Spinner */}
      <SectionTitle title="Loading Spinner" />
      <View style={styles.spinnerGroup}>
        <LoadingSpinner size="small" />
        <LoadingSpinner size="large" />
        <LoadingSpinner message="Cargando datos..." />
      </View>

      <View style={{ height: spacing.xxxxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background.secondary,
  },
  content: {
    padding: spacing.m,
  },
  sectionTitle: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
    color: colors.text.primary,
    marginTop: spacing.xxl,
    marginBottom: spacing.m,
  },
  subTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.s,
    marginBottom: spacing.xs,
  },
  row: {
    marginBottom: spacing.m,
  },
  // Color swatches
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.s,
    marginBottom: spacing.s,
  },
  swatchContainer: {
    alignItems: 'center',
    width: 56,
  },
  swatch: {
    width: 48,
    height: 48,
    borderRadius: radii.s,
    marginBottom: spacing.micro,
  },
  swatchLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.micro,
    color: colors.text.primary,
  },
  swatchValue: {
    fontFamily: typography.fonts.body,
    fontSize: 8,
    color: colors.text.tertiary,
  },
  // Typography samples
  hero: {
    fontFamily: typography.fonts.headingExtra,
    fontSize: typography.sizes.hero,
    lineHeight: typography.lineHeights.hero,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  h1: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h1,
    lineHeight: typography.lineHeights.h1,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  h2: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
    lineHeight: typography.lineHeights.h2,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  h3: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    lineHeight: typography.lineHeights.h3,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  h4: {
    fontFamily: typography.fonts.headingMedium,
    fontSize: typography.sizes.h4,
    lineHeight: typography.lineHeights.h4,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  body: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  bodyMedium: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  bodySemiBold: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  bodySmall: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    lineHeight: typography.lineHeights.bodySmall,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
  },
  caption: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    lineHeight: typography.lineHeights.caption,
    color: colors.text.tertiary,
    marginBottom: spacing.xs,
  },
  // Buttons
  buttonGroup: {
    gap: spacing.s,
    marginBottom: spacing.m,
  },
  // Inputs
  inputGroup: {
    gap: spacing.m,
  },
  // Cards
  cardGroup: {
    gap: spacing.m,
  },
  cardTitle: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h4,
    color: colors.text.primary,
    marginBottom: spacing.micro,
  },
  cardBody: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
  },
  // Badges
  badgeGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.m,
  },
  // Spinners
  spinnerGroup: {
    gap: spacing.l,
    alignItems: 'center',
    paddingVertical: spacing.m,
  },
});
