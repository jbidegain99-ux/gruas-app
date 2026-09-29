// Helpers de las pantallas de equipo, invitación y 2FA (migr. 00113, POR-02).
// Separados de las páginas para poder probarlos sin montar React.

/**
 * Solo rutas internas: `next` viene de la URL y un "//otro-sitio.com" o un
 * "https://..." convertiría la pantalla de 2FA en un redireccionador abierto.
 */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

/** El enlace que viaja en el correo de invitación. */
export function invitationUrl(origin: string, token: string): string {
  return `${origin}/invitacion?token=${encodeURIComponent(token)}`;
}

export type MemberRole = 'owner' | 'admin' | 'analyst' | 'viewer';

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Dueño de la cuenta',
  admin: 'Administrador',
  analyst: 'Analista',
  viewer: 'Solo lectura',
};

/** Qué roles puede asignar cada quien (la base lo vuelve a validar). */
export function assignableRoles(myRole: MemberRole): MemberRole[] {
  return myRole === 'owner' ? ['owner', 'admin', 'analyst', 'viewer'] : ['analyst', 'viewer'];
}

export function requiresMfa(role: MemberRole): boolean {
  return role === 'owner' || role === 'admin';
}
