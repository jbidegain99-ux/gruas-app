import { describe, expect, it } from 'vitest';
import { brandLogoUrl, brandTextColor, parseBrand } from '../brand';

describe('marca blanca en la app', () => {
  it('ignora respuestas vacías o sin nombre, y colores inválidos', () => {
    expect(parseBrand(null)).toBeNull();
    expect(parseBrand({ brand_name: '' })).toBeNull();
    expect(parseBrand({ brand_name: 'AV XYZ', color: 'rojo', logo_path: null, insurer_name: 'XYZ' })?.color).toBeNull();
  });

  it('arma la URL pública del logo', () => {
    expect(brandLogoUrl('http://127.0.0.1:54321', 'a/logo 1.png')).toBe(
      'http://127.0.0.1:54321/storage/v1/object/public/insurer-branding/a/logo%201.png',
    );
    expect(brandLogoUrl('http://x', null)).toBeNull();
  });

  it('texto blanco sobre azul oscuro y oscuro sobre naranja (nunca blanco sobre naranja)', () => {
    expect(brandTextColor('#1F4E79')).toBe('#FFFFFF');
    expect(brandTextColor('#FF7A1F')).toBe('#111827');
  });
});
