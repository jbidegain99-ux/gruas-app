// Marca blanca de la aseguradora en la app del afiliado (migr. 00135, ASE-05).

export type InsurerBrand = {
  brand_name: string;
  color: string | null;
  logo_path: string | null;
  insurer_name: string;
};

export function parseBrand(d: unknown): InsurerBrand | null {
  if (!d || typeof d !== 'object') return null;
  const r = d as Record<string, unknown>;
  if (typeof r.brand_name !== 'string' || !r.brand_name) return null;
  return {
    brand_name: r.brand_name,
    color: typeof r.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(r.color) ? r.color : null,
    logo_path: typeof r.logo_path === 'string' ? r.logo_path : null,
    insurer_name: String(r.insurer_name ?? ''),
  };
}

/** URL pública del logo (bucket público `insurer-branding`). */
export function brandLogoUrl(base: string, path: string | null): string | null {
  if (!path || !base) return null;
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/insurer-branding/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Texto legible sobre el color de marca (blanco o casi negro). */
export function brandTextColor(color: string): '#FFFFFF' | '#111827' {
  const l = luminance(color);
  return (1.05) / (l + 0.05) >= (l + 0.05) / (luminance('#111827') + 0.05) ? '#FFFFFF' : '#111827';
}
