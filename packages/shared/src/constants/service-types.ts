import type { ServiceType } from '../types/enums';

export interface ServiceTypeConfig {
  type: ServiceType;
  emoji: string;
  name: string;
  color: string;
}

export const SERVICE_TYPE_CONFIGS: Record<ServiceType, ServiceTypeConfig> = {
  tow:       { type: 'tow',       emoji: '🚛', name: 'Grua',        color: '#E67E22' },
  battery:   { type: 'battery',   emoji: '🔋', name: 'Bateria',     color: '#2ECC71' },
  tire:      { type: 'tire',      emoji: '🛞', name: 'Llanta',      color: '#3498DB' },
  fuel:      { type: 'fuel',      emoji: '⛽', name: 'Combustible', color: '#E74C3C' },
  locksmith: { type: 'locksmith', emoji: '🔑', name: 'Cerrajeria',  color: '#9B59B6' },
  mechanic:  { type: 'mechanic',  emoji: '🔧', name: 'Mecanico',    color: '#F39C12' },
  winch:     { type: 'winch',     emoji: '🏗️', name: 'Winche',      color: '#1ABC9C' },
};
