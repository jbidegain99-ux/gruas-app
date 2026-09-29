import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adminNavFor, adminRouteRoles, canEnterAdminRoute, ADMIN_ROUTES } from './admin-routes';

// Todas las páginas reales bajo app/admin, como rutas (`[id]` -> un segmento cualquiera).
function adminPages(): string[] {
  const base = join(__dirname, '..', '..', 'app', 'admin');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'page.tsx') {
        const rel = relative(base, dir).split(sep).filter(Boolean);
        out.push('/admin' + rel.map((s) => (s.startsWith('[') ? '/x' : '/' + s)).join(''));
      }
    }
  };
  walk(base);
  return out;
}

describe('admin-routes', () => {
  it('toda página bajo app/admin está cubierta por una ruta con roles', () => {
    const pages = adminPages();
    expect(pages.length).toBeGreaterThan(10);
    const uncovered = pages.filter((p) => !adminRouteRoles(p)?.length);
    expect(uncovered).toEqual([]);
  });

  it('una ruta no declarada no es libre: nadie entra', () => {
    expect(adminRouteRoles('/admin/nueva-pagina')).toBeNull();
    expect(canEnterAdminRoute('/admin/nueva-pagina', 'ADMIN')).toBe(false);
    // `/admin` cubre solo el dashboard, no todo lo que empieza con él.
    expect(adminRouteRoles('/admin/requestsX')).toBeNull();
  });

  it('soporte entra a la operación y no al dinero ni a la configuración', () => {
    for (const p of ['/admin', '/admin/requests', '/admin/fleet', '/admin/users', '/admin/providers', '/admin/verifications', '/admin/ratings', '/admin/socios']) {
      expect(canEnterAdminRoute(p, 'SUPPORT'), p).toBe(true);
    }
    for (const p of ['/admin/finance', '/admin/cuentas', '/admin/tarifas', '/admin/pricing', '/admin/services', '/admin/insurers', '/admin/insurers/abc', '/admin/policies/abc', '/admin/mopt', '/admin/audit', '/admin/negocio', '/admin/cuentas/provider/abc']) {
      expect(canEnterAdminRoute(p, 'SUPPORT'), p).toBe(false);
    }
  });

  it('el admin entra a todo; los demás roles a nada', () => {
    for (const r of ADMIN_ROUTES) {
      expect(canEnterAdminRoute(r.href, 'ADMIN')).toBe(true);
      for (const role of ['USER', 'OPERATOR', 'INSURER', 'MOPT'] as const) {
        expect(canEnterAdminRoute(r.href, role)).toBe(false);
      }
    }
    expect(canEnterAdminRoute('/admin', null)).toBe(false);
  });

  it('el menú de soporte solo muestra lo que puede abrir', () => {
    const labels = adminNavFor('SUPPORT').map((r) => r.label);
    expect(labels).toContain('Solicitudes');
    expect(labels).not.toContain('Finanzas');
    expect(labels).not.toContain('Pólizas');
    expect(adminNavFor('ADMIN').some((r) => r.href === '/admin/policies')).toBe(false);
  });
});
