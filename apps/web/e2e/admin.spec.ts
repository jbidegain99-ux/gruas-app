import { test, expect } from '@playwright/test';

// Test data
const ADMIN_EMAIL = 'admin@test.com';
const ADMIN_PASSWORD = 'testpassword123';

test.describe('Landing Page', () => {
  test('homepage displays correctly', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Gruas App/);
    await expect(page.locator('text=Gruas App')).toBeVisible();
    await expect(page.locator('text=El Salvador')).toBeVisible();
  });

  test('has login and admin portal buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /iniciar sesion/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /admin portal/i })).toBeVisible();
  });

  test('can navigate to login page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /iniciar sesion/i }).click();
    await expect(page).toHaveURL('/login');
    await expect(page.locator('h1')).toContainText('Iniciar Sesion');
  });

  test('can navigate to admin portal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /admin portal/i }).click();
    // Should redirect to login since not authenticated
    await expect(page).toHaveURL(/login/);
  });
});

test.describe('Authentication', () => {
  test('login page has all required fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/contrasena/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /iniciar sesion/i })).toBeVisible();
  });

  test('register page has all required fields', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByLabel(/nombre completo/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/telefono/i)).toBeVisible();
    await expect(page.getByLabel(/contrasena/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /crear cuenta/i })).toBeVisible();
  });

  test('shows error on invalid login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('invalid@email.com');
    await page.getByLabel(/contrasena/i).fill('wrongpassword');
    await page.getByRole('button', { name: /iniciar sesion/i }).click();

    // Should show error or stay on login page
    await expect(page).toHaveURL(/login/);
  });

  test('has link to register from login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: /registrate/i })).toBeVisible();
  });

  test('has link to login from register', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('link', { name: /inicia sesion/i })).toBeVisible();
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

test.describe('MOP Portal (unauthenticated)', () => {
  test('redirects to login when accessing MOP without auth', async ({ page }) => {
    await page.goto('/mop');
    await expect(page).toHaveURL(/login/);
  });

  test('redirects to login when accessing MOP/requests without auth', async ({ page }) => {
    await page.goto('/mop/requests');
    await expect(page).toHaveURL(/login/);
  });
});

// Authenticated tests would require setting up test users in Supabase
// For CI, these can be run with seeded test data
test.describe.skip('Admin Portal (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/contrasena/i).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /iniciar sesion/i }).click();
    await page.waitForURL('/admin');
  });

  test('admin dashboard loads', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('can navigate to providers page', async ({ page }) => {
    await page.getByRole('link', { name: /proveedores/i }).click();
    await expect(page).toHaveURL('/admin/providers');
    await expect(page.locator('h1')).toContainText('Proveedores');
  });

  test('can navigate to requests page', async ({ page }) => {
    await page.getByRole('link', { name: /solicitudes/i }).click();
    await expect(page).toHaveURL('/admin/requests');
    await expect(page.locator('h1')).toContainText('Solicitudes');
  });

  test('can navigate to pricing page', async ({ page }) => {
    await page.getByRole('link', { name: /tarifas/i }).click();
    await expect(page).toHaveURL('/admin/pricing');
    await expect(page.locator('h1')).toContainText('Tarifas');
  });

  test('can navigate to users page', async ({ page }) => {
    await page.getByRole('link', { name: /usuarios/i }).click();
    await expect(page).toHaveURL('/admin/users');
    await expect(page.locator('h1')).toContainText('Usuarios');
  });

  test('pricing page shows pricing rules', async ({ page }) => {
    await page.goto('/admin/pricing');
    await expect(page.locator('table')).toBeVisible();
    await expect(page.getByText('Tarifa Estándar')).toBeVisible();
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
    await expect(page.getByRole('button', { name: /nueva tarifa/i })).toBeVisible();
  });
});
