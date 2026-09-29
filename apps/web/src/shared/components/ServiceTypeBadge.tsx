import {
  Truck,
  Battery,
  CircleDot,
  Fuel,
  KeyRound,
  Wrench,
  CableCar,
  Droplets,
} from 'lucide-react';
import type { ComponentType } from 'react';

interface ServiceTypeInfo {
  label: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
}

const SERVICE_TYPES: Record<string, ServiceTypeInfo> = {
  tow:       { label: 'Grúa',        icon: Truck,     color: 'text-orange-600' },
  battery:   { label: 'Batería',     icon: Battery,   color: 'text-green-600' },
  tire:      { label: 'Llanta',      icon: CircleDot, color: 'text-blue-600' },
  fuel:      { label: 'Combustible', icon: Fuel,      color: 'text-red-600' },
  locksmith: { label: 'Cerrajería',  icon: KeyRound,  color: 'text-purple-600' },
  mechanic:  { label: 'Mecánico',    icon: Wrench,    color: 'text-amber-600' },
  winch:     { label: 'Winche',      icon: CableCar,  color: 'text-teal-600' },
  water_truck: { label: 'Pipa de agua', icon: Droplets, color: 'text-sky-600' },
};

export function ServiceTypeBadge({ serviceType }: { serviceType: string }) {
  const info = SERVICE_TYPES[serviceType] || SERVICE_TYPES.tow;
  const Icon = info.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${info.color}`}>
      <Icon className="h-4 w-4" />
      {info.label}
    </span>
  );
}

/** Nombre del servicio en español (para filtros y exportaciones). */
export function serviceTypeLabel(serviceType: string | null | undefined): string {
  return SERVICE_TYPES[serviceType || 'tow']?.label ?? serviceType ?? '—';
}

export const SERVICE_TYPE_KEYS = Object.keys(SERVICE_TYPES);
