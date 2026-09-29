// Opciones del embudo de socios (backlog AGT-01/02). Compartidas entre la
// landing, el registro y el panel; la base valida los mismos valores.

export const PARTNER_VEHICLE_TYPES = [
  { value: 'tow_light', label: 'Grúa liviana' },
  { value: 'tow_heavy', label: 'Grúa pesada' },
  { value: 'water_truck', label: 'Pipa de agua' },
  { value: 'service', label: 'Vehículo de servicio (batería, llanta, cerrajería…)' },
] as const;

export const PARTNER_SERVICES = [
  { value: 'tow', label: 'Grúa' },
  { value: 'winch', label: 'Winche' },
  { value: 'battery', label: 'Batería' },
  { value: 'tire', label: 'Llanta' },
  { value: 'fuel', label: 'Combustible' },
  { value: 'locksmith', label: 'Cerrajería' },
  { value: 'mechanic', label: 'Mecánico' },
  { value: 'water_truck', label: 'Pipa de agua' },
] as const;

/** Los 14 departamentos de El Salvador: la "zona" del pre-registro. */
export const SV_DEPARTMENTS = [
  'Ahuachapán', 'Cabañas', 'Chalatenango', 'Cuscatlán', 'La Libertad', 'La Paz', 'La Unión',
  'Morazán', 'San Miguel', 'San Salvador', 'San Vicente', 'Santa Ana', 'Sonsonate', 'Usulután',
] as const;

/** Teléfono salvadoreño: 8 dígitos que empiezan en 2, 6 o 7 (con o sin +503). */
export function normalizeSvPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').replace(/^503(?=\d{8}$)/, '');
  return /^[267]\d{7}$/.test(digits) ? `+503${digits}` : null;
}
