import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ServiceRequestStatus } from '@gruas-app/shared';
import { colors, typography, spacing, radii } from '@/theme';

interface StatusBadgeProps {
  status: ServiceRequestStatus;
  size?: 'small' | 'default';
}

const STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  initiated: 'Iniciado',
  assigned: 'Asignado',
  en_route: 'En camino',
  active: 'En progreso',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

export function StatusBadge({ status, size = 'default' }: StatusBadgeProps) {
  const statusColors = colors.status[status];
  const isSmall = size === 'small';

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: statusColors.bg },
        isSmall && styles.containerSmall,
      ]}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: statusColors.dot },
          isSmall && styles.dotSmall,
        ]}
      />
      <Text
        style={[
          styles.label,
          { color: statusColors.text },
          isSmall && styles.labelSmall,
        ]}
      >
        {STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radii.full,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.micro + 2,
    gap: spacing.xs,
  },
  containerSmall: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.micro,
    gap: spacing.micro,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.caption,
  },
  labelSmall: {
    fontSize: typography.sizes.micro,
  },
});
