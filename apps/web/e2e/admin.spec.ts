import { test, expect } from '@playwright/test';

// Credenciales del admin para el bloque autenticado: por entorno, nunca en el
// repo. Sin ellas ese bloque se salta (p. ej. en CI sin base con datos).
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

test.describe('Landing Page', () => {
  test('homepage displays correctly', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Budi/);
    await expect(page.getByRole('banner').getByText('Budi', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: /grúa/i })
    ).toBeVisible();
  });

  test('has login and partners links', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('link', { name: /iniciar sesi[oó]n/i })).toBeVisible();
    // La landing pública ya no anuncia el portal administrativo.
    await expect(page.getByRole('link', { name: /admin portal/i })).toHaveCount(0);
  });

  test('can navigate to login page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: /iniciar sesi[oó]n/i }).click();
    await expect(page).toHaveURL('/login', { timeout: 15_000 });
    await expect(page.locator('h1')).toContainText(/Iniciar sesi[oó]n/i);
  });

  test('can navigate to partners landing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Conoce cómo ser socio' }).click();
    await expect(page).toHaveURL('/socios', { timeout: 15_000 });
  });

  test('admin portal requires login', async ({ page }) => {
    await page.goto('/admin');
    // Should redirect to login since not authenticated
    await expect(page).toHaveURL(/login/);
  });
});

test.describe('Authentication', () => {
  test('login page has all required fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/contrase[nñ]a/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /iniciar sesi[oó]n/i })).toBeVisible();
  });

  test('register page has all required fields', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByLabel(/nombre completo/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/tel[eé]fono/i)).toBeVisible();
    // Anclado: /contrase[nñ]a/i solo tambien casa con "Confirmar contraseña".
    await expect(page.getByLabel(/^contrase[nñ]a$/i)).toBeVisible();
    await expect(page.getByLabel(/confirmar contrase[nñ]a/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /crear cuenta/i })).toBeVisible();
  });

  // Decreto 144: el aviso de privacidad es requisito para crear la cuenta,
  // el marketing es opcional y va aparte (ver features/auth/RegisterPage.tsx).
  test('register page requires accepting the privacy notice', async ({ page }) => {
    await page.goto('/register');

    const privacy = page.getByRole('checkbox', { name: /aviso de privacidad/i });
    const marketing = page.getByRole('checkbox', { name: /promociones/i });
    const submit = page.getByRole('button', { name: /crear cuenta/i });

    // Ninguna casilla viene premarcada y el submit arranca deshabilitado.
    await expect(privacy).not.toBeChecked();
    await expect(marketing).not.toBeChecked();
    await expect(submit).toBeDisabled();

    // El marketing por si solo no habilita nada: son consentimientos separados.
    await marketing.check();
    await expect(submit).toBeDisabled();

    await privacy.check();
    await expect(submit).toBeEnabled();
  });

  test('shows error on invalid login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('invalid@email.com');
    await page.getByLabel(/contrase[nñ]a/i).fill('wrongpassword');
    await page.getByRole('button', { name: /iniciar sesi[oó]n/i }).click();

    // Should show error or stay on login page
    await expect(page).toHaveURL(/login/);
  });

  test('has link to register from login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: /reg[ií]strate/i })).toBeVisible();
  });

  test('has link to login from register', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('link', { name: /inicia sesi[oó]n/i })).toBeVisible();
  });
});

test.describe('Admin Portal (unauthenticated)', () => {
  test('redirects to login when accessing admin without auth', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/login/);
  });

  test('redirects to login when accessing admin/providers without auth', async ({ page }) => {
    await page.goto('/admin/providers');
    await expect(page).toHaveURL(/login/);
  });

  test('redirects to login when accessing admin/pricing without auth', async ({ page }) => {
    await page.goto('/admin/pricing');
    await expect(page).toHaveURL(/login/);
  });

  test('redirects to login when accessing admin/users without auth', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/login/);
  });
});

test.describe('Admin Portal (authenticated)', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Define E2E_ADMIN_EMAIL y E2E_ADMIN_PASSWORD para correrlo');
  // En serie: varios logins simultáneos contra el servidor de desarrollo (que
  // compila cada ruta la primera vez) daban timeouts que no eran fallas reales.
  test.describe.configure({ mode: 'serial', timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    // Login as admin
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/contrase[nñ]a/i).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /iniciar sesi[oó]n/i }).click();
    await page.waitForURL('/admin', { timeout: 30_000 });
  });

  test('admin dashboard loads', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('can navigate to providers page', async ({ page }) => {
    await page.getByRole('link', { name: /proveedores/i }).click();
    await expect(page).toHaveURL('/admin/providers', { timeout: 15_000 });
    await expect(page.locator('h1')).toContainText('Proveedores');
  });

  test('can navigate to requests page', async ({ page }) => {
    await page.getByRole('link', { name: /solicitudes/i }).click();
    await expect(page).toHaveURL('/admin/requests', { timeout: 15_000 });
    await expect(page.locator('h1')).toContainText('Solicitudes');
  });

  test('can navigate to pricing page', async ({ page }) => {
    await page.getByRole('link', { name: /precios/i }).click();
    await expect(page).toHaveURL('/admin/pricing', { timeout: 15_000 });
    await expect(page.locator('h1')).toContainText('Reglas de Precios');
  });

  test('can navigate to rates (comisiones versionadas)', async ({ page }) => {
    await page.getByRole('link', { name: /^tarifas$/i }).click();
    await expect(page).toHaveURL('/admin/tarifas', { timeout: 15_000 });
    await expect(page.locator('h1')).toContainText('Tarifas');
  });

  test('can navigate to users page', async ({ page }) => {
    await page.getByRole('link', { name: /usuarios/i }).click();
    await expect(page).toHaveURL('/admin/users', { timeout: 15_000 });
    await expect(page.locator('h1')).toContainText('Usuarios');
  });

  test('pricing page shows pricing rules', async ({ page }) => {
    await page.goto('/admin/pricing');
    await expect(page.locator('table')).toBeVisible();
    await expect(page.getByText(/Tarifa Estándar/).first()).toBeVisible();
  });

  test('users page shows user list', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.locator('table')).toBeVisible();
  });

  test('providers page has add button', async ({ page }) => {
    await page.goto('/admin/providers');
    await expect(page.getByRole('button', { name: /agregar proveedor/i })).toBeVisible();
  });

  test('pricing page has add button', async ({ page }) => {
    await page.goto('/admin/pricing');
    await expect(page.getByRole('button', { name: /nueva regla/i })).toBeVisible();
  });
});
