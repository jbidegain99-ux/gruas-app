import {
  Truck,
  Battery,
  CircleDot,
  Fuel,
  KeyRound,
  Wrench,
  CableCar,
} from 'lucide-react';
import type { ComponentType } from 'react';

interface ServiceTypeInfo {
  label: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
}

const SERVICE_TYPES: Record<string, ServiceTypeInfo> = {
  tow:       { label: 'Grua',        icon: Truck,     color: 'text-orange-600' },
  battery:   { label: 'Bateria',     icon: Battery,   color: 'text-green-600' },
  tire:      { label: 'Llanta',      icon: CircleDot, color: 'text-blue-600' },
  fuel:      { label: 'Combustible', icon: Fuel,      color: 'text-red-600' },
  locksmith: { label: 'Cerrajeria',  icon: KeyRound,  color: 'text-purple-600' },
  mechanic:  { label: 'Mecanico',    icon: Wrench,    color: 'text-amber-600' },
  winch:     { label: 'Winche',      icon: CableCar,  color: 'text-teal-600' },
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
