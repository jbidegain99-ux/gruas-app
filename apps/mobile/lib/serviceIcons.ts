import type { ComponentType } from 'react';
import { Truck, Battery, CircleDot, Fuel, KeyRound, Wrench, ChevronsUp } from 'lucide-react-native';
import type { ServiceType } from '@gruas-app/shared';

type LucideIconComponent = ComponentType<{ size: number; color: string; strokeWidth: number }>;

export const SERVICE_ICONS: Record<ServiceType, LucideIconComponent> = {
  tow: Truck,
  battery: Battery,
  tire: CircleDot,
  fuel: Fuel,
  locksmith: KeyRound,
  mechanic: Wrench,
  winch: ChevronsUp,
};
