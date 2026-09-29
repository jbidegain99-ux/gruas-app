import { describe, expect, it } from 'vitest';
import { contrastRatio, isHexColor, logoUrl, textOn } from './brand';

describe('marca blanca', () => {
  it('arma la URL pública del logo y escapa el nombre', () => {
    expect(logoUrl('abc/logo 1.png', 'http://x/')).toBe('http://x/storage/v1/object/public/insurer-branding/abc/logo%201.png');
    expect(logoUrl(null, 'http://x')).toBeNull();
  });

  it('valida colores hexadecimales de 6 dígitos', () => {
    expect(isHexColor('#1F4E79')).toBe(true);
    expect(isHexColor('#FFF')).toBe(false);
    expect(isHexColor('red')).toBe(false);
  });

  it('elige el texto con más contraste sobre el color de marca', () => {
    expect(textOn('#1F4E79')).toBe('#FFFFFF');
    // Naranja Budi: nunca texto blanco encima (regla del backlog).
    expect(textOn('#FF7A1F')).toBe('#111827');
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
  });
});
