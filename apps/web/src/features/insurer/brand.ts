// Marca blanca de la aseguradora (migr. 00135, ASE-05).

export type Branding = {
  insurer_id: string;
  insurer_name: string;
  enabled: boolean;
  brand_name: string | null;
  color: string | null;
  logo_path: string | null;
  can_edit?: boolean;
};

export const BRAND_BUCKET = 'insurer-branding';
export const MAX_LOGO_BYTES = 512 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** URL pública del logo (bucket público). */
export function logoUrl(path: string | null | undefined, base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''): string | null {
  if (!path) return null;
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/${BRAND_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function isHexColor(v: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(v);
}

/** Luminancia relativa WCAG de un color #RRGGBB. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Texto legible sobre el color de marca: blanco o casi negro, el que contraste más. */
export function textOn(color: string): '#FFFFFF' | '#111827' {
  return contrastRatio(color, '#FFFFFF') >= contrastRatio(color, '#111827') ? '#FFFFFF' : '#111827';
}
