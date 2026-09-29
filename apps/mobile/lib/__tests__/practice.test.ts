import { describe, expect, it } from 'vitest';
import { checkPracticePin, nextStep, progress, PRACTICE_PIN } from '../practice';

describe('servicio de práctica', () => {
  it('avanza en orden y se queda en el final', () => {
    expect(nextStep('offer')).toBe('enroute');
    expect(nextStep('pin')).toBe('working');
    expect(nextStep('done')).toBe('done');
  });

  it('valida el PIN como el servicio real', () => {
    expect(checkPracticePin('24')).toBe('incomplete');
    expect(checkPracticePin('1111')).toBe('wrong');
    expect(checkPracticePin(PRACTICE_PIN)).toBe('ok');
  });

  it('el progreso va de 0 a 1', () => {
    expect(progress('offer')).toBe(0);
    expect(progress('done')).toBe(1);
  });
});
