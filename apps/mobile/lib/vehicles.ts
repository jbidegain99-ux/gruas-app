export type Vehicle = {
  id: string;
  make: string | null;
  model: string | null;
  plate: string | null;
  color: string | null;
  is_default: boolean;
};

// Etiqueta legible: "Toyota Corolla Blanco · P123-456".
export function vehicleLabel(v: {
  make: string | null;
  model: string | null;
  color: string | null;
  plate: string | null;
}): string {
  const main = [v.make, v.model, v.color].filter(Boolean).join(' ');
  return [main, v.plate].filter(Boolean).join(' · ') || 'Vehículo';
}
