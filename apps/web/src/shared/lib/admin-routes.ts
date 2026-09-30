/**
 * Las rutas del panel admin, como DATOS (patrón "navegación como dato" del
 * spec de super admin, §3).
 *
 * Lo consumen dos cosas: el menú lateral (AdminNav) y el guard de acceso del
 * proxy (middleware.ts). Así no puede pasar lo de "agregué la página al menú y
 * me olvidé del guard": es la misma lista.
 *
 * `roles` NO es "se muestra en el menú": es "puede entrar", aunque la URL se
 * escriba a mano. Una ruta que no está acá no es "libre": es inalcanzable para
 * todos (adminRouteRoles devuelve null y el guard lo trata como "no entra").
 * Un test (admin-routes.test.ts) falla si existe una página bajo app/admin que
 * no esté cubierta.
 *
 * Esto es la primera línea. La contención real de SUPPORT es la base: RLS y el
 * guard de cada RPC (migr. 00104, test en supabase/tests/support_role.sql).
 * Una ruta mal declarada acá le mostraría una pantalla vacía o con errores,
 * no datos.
 */
import type { Database } from '@gruas-app/shared';

type UserRole = Database['public']['Enums']['user_role'];

/** Los roles que pueden entrar al panel. */
export const ADMIN_PANEL_ROLES: readonly UserRole[] = ['ADMIN', 'SUPPORT'];

const ADMIN_ONLY: readonly UserRole[] = ['ADMIN'];
const STAFF: readonly UserRole[] = ['ADMIN', 'SUPPORT'];

export type AdminRoute = {
  href: string;
  label: string;
  /** Clave del ícono; el mapa a componentes vive en AdminNav (el proxy no los necesita). */
  icon: string;
  roles: readonly UserRole[];
  /** false = protegida pero fuera del menú (páginas de detalle). */
  inNav?: boolean;
};

export const ADMIN_ROUTES: readonly AdminRoute[] = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard', roles: STAFF },
  // Tendencias de 6 meses con dinero (00105).
  { href: '/admin/negocio', label: 'Negocio', icon: 'business', roles: ADMIN_ONLY },
  { href: '/admin/requests', label: 'Solicitudes', icon: 'requests', roles: STAFF },
  { href: '/admin/fleet', label: 'Flota', icon: 'fleet', roles: STAFF },
  { href: '/admin/finance', label: 'Finanzas', icon: 'finance', roles: ADMIN_ONLY },
  { href: '/admin/cuentas', label: 'Cuentas', icon: 'accounts', roles: ADMIN_ONLY },
  // LAN-08 (00125): lotes de pago a socios y empresas, con archivo para el banco.
  { href: '/admin/pagos', label: 'Pagos a socios', icon: 'payouts', roles: ADMIN_ONLY },
  // LAN-07 (00133): lo que pagan los Usuarios (efectivo al socio o tarjeta).
  { href: '/admin/cobros', label: 'Cobros a usuarios', icon: 'collections', roles: ADMIN_ONLY },
  // MOPT-03 / ASE-03 (00123): cierre mensual por cliente institucional.
  { href: '/admin/estados-de-cuenta', label: 'Estados de cuenta', icon: 'statements', roles: ADMIN_ONLY },
  // LAN-09 (base, 00140): datos fiscales para el DTE.
  { href: '/admin/facturacion', label: 'Facturación', icon: 'billing', roles: ADMIN_ONLY },
  // La ficha 360 vive bajo Cuentas (/admin/cuentas/[tipo]/[id]) y hereda su acceso.
  // VEN-03 (00130): checklist de alta de aseguradoras y programas MOPT.
  { href: '/admin/altas', label: 'Altas de clientes', icon: 'onboarding', roles: ADMIN_ONLY },
  { href: '/admin/insurers', label: 'Aseguradoras', icon: 'insurers', roles: ADMIN_ONLY },
  { href: '/admin/policies', label: 'Pólizas', icon: 'insurers', roles: ADMIN_ONLY, inNav: false },
  { href: '/admin/providers', label: 'Proveedores', icon: 'providers', roles: STAFF },
  { href: '/admin/mopt', label: 'Programas MOPT', icon: 'mopt', roles: ADMIN_ONLY },
  // REA-01 (00131): reaseguradoras y sus aseguradoras cedentes.
  { href: '/admin/reaseguradoras', label: 'Reaseguradoras', icon: 'reinsurers', roles: ADMIN_ONLY },
  { href: '/admin/services', label: 'Servicios', icon: 'services', roles: ADMIN_ONLY },
  { href: '/admin/pricing', label: 'Precios', icon: 'pricing', roles: ADMIN_ONLY },
  { href: '/admin/tarifas', label: 'Tarifas', icon: 'rates', roles: ADMIN_ONLY },
  { href: '/admin/users', label: 'Usuarios', icon: 'users', roles: STAFF },
  { href: '/admin/verifications', label: 'Verificaciones', icon: 'verifications', roles: STAFF },
  // AGT-01 (00114): pre-registros de /socios. Soporte opera el embudo.
  { href: '/admin/socios', label: 'Socios interesados', icon: 'leads', roles: STAFF },
  { href: '/admin/ratings', label: 'Calificaciones', icon: 'ratings', roles: STAFF },
  // APP-09 (00118): versión mínima de la app móvil.
  { href: '/admin/app', label: 'App móvil', icon: 'app', roles: ADMIN_ONLY },
  { href: '/admin/audit', label: 'Bitácora', icon: 'audit', roles: ADMIN_ONLY },
];

/**
 * Roles que pueden entrar a `pathname`, o null si ninguna ruta lo cubre
 * (= nadie entra). Gana el prefijo más largo: `/admin` solo cubre `/admin`
 * exacto, no todo lo que empieza con él.
 */
export function adminRouteRoles(pathname: string): readonly UserRole[] | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  let best: AdminRoute | null = null;
  for (const route of ADMIN_ROUTES) {
    const match =
      route.href === '/admin'
        ? path === '/admin'
        : path === route.href || path.startsWith(route.href + '/');
    if (match && (!best || route.href.length > best.href.length)) best = route;
  }
  return best ? best.roles : null;
}

export function canEnterAdminRoute(pathname: string, role: UserRole | null | undefined): boolean {
  const roles = adminRouteRoles(pathname);
  return !!role && !!roles && roles.includes(role);
}

/** Las entradas del menú que ve un rol. */
export function adminNavFor(role: UserRole | null | undefined): AdminRoute[] {
  return ADMIN_ROUTES.filter((r) => r.inNav !== false && !!role && r.roles.includes(role));
}
