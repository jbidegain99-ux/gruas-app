// Servicio de práctica del socio operador (AGT-05, migr. 00137). Todo es
// simulado: no crea solicitudes, no mueve dinero ni cuenta en ganancias.

export type PracticeStep = 'offer' | 'enroute' | 'pin' | 'working' | 'cash' | 'done';

export const PRACTICE_STEPS: PracticeStep[] = ['offer', 'enroute', 'pin', 'working', 'cash', 'done'];

/** El PIN que "dice" el Usuario de mentira. */
export const PRACTICE_PIN = '2468';

export const PRACTICE_SERVICE = {
  service: 'Grúa liviana',
  user: 'Ana (Usuaria de práctica)',
  pickup: 'Col. Escalón, San Salvador',
  dropoff: 'Taller El Progreso, Soyapango',
  km: 9.4,
  price: 35,
  payer: 'Particular: te paga en efectivo',
};

export function nextStep(s: PracticeStep): PracticeStep {
  const i = PRACTICE_STEPS.indexOf(s);
  return PRACTICE_STEPS[Math.min(i + 1, PRACTICE_STEPS.length - 1)];
}

/** Revisa el PIN como lo hace el servicio real: 4 dígitos exactos. */
export function checkPracticePin(pin: string): 'ok' | 'incomplete' | 'wrong' {
  if (!/^\d{4}$/.test(pin)) return 'incomplete';
  return pin === PRACTICE_PIN ? 'ok' : 'wrong';
}

export function progress(s: PracticeStep): number {
  return PRACTICE_STEPS.indexOf(s) / (PRACTICE_STEPS.length - 1);
}
