import { test, expect } from '@playwright/test';

// Test data for MOP user
const MOP_EMAIL = 'mop@test.com';
const MOP_PASSWORD = 'testpassword123';

test.describe('MOP Portal Access Control', () => {
  test('MOP portal requires authentication', async ({ page }) => {
    await page.goto('/mop');
    await expect(page).toHaveURL(/login/);
  });

  test('MOP requests page requires authentication', async ({ page }) => {
    await page.goto('/mop/requests');
    await expect(page).toHaveURL(/login/);
  });
});

// Authenticated MOP tests - requires seeded test data
test.describe.skip('MOP Portal (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    // Login as MOP user
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(MOP_EMAIL);
    await page.getByLabel(/contraseña/i).fill(MOP_PASSWORD);
    await page.getByRole('button', { name: /iniciar sesión/i }).click();
    await page.waitForURL('/mop');
  });

  test('MOP dashboard loads', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('can navigate to requests page', async ({ page }) => {
    await page.getByRole('link', { name: /solicitudes/i }).click();
    await expect(page).toHaveURL('/mop/requests');
    await expect(page.locator('h1')).toContainText('Solicitudes de Servicio');
  });

  test('requests page has status filters', async ({ page }) => {
    await page.goto('/mop/requests');
    await expect(page.getByRole('button', { name: /todas/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /pendiente/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /asignada/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /completada/i })).toBeVisible();
  });

  test('requests page shows table', async ({ page }) => {
    await page.goto('/mop/requests');
    await expect(page.locator('table')).toBeVisible();
  });

  test('clicking request opens detail modal', async ({ page }) => {
    await page.goto('/mop/requests');

    // Wait for table to load
    await page.waitForSelector('table tbody tr');

    // Click on first request's "Ver Detalle" button
    const detailButton = page.getByRole('button', { name: /ver detalle/i }).first();
    if (await detailButton.isVisible()) {
      await detailButton.click();
      await expect(page.getByText('Detalle de Solicitud')).toBeVisible();
    }
  });

  test('detail modal shows audit trail', async ({ page }) => {
    await page.goto('/mop/requests');

    await page.waitForSelector('table tbody tr');

    const detailButton = page.getByRole('button', { name: /ver detalle/i }).first();
    if (await detailButton.isVisible()) {
      await detailButton.click();
      await expect(page.getByText('Historial de Eventos')).toBeVisible();
    }
  });

  test('can filter requests by status', async ({ page }) => {
    await page.goto('/mop/requests');

    // Click on "Completada" filter
    await page.getByRole('button', { name: /completada/i }).click();

    // The filter should be active (check for visual indicator)
    await expect(page.getByRole('button', { name: /completada/i })).toHaveClass(/bg-emerald/);
  });

  test('sidebar shows user info', async ({ page }) => {
    await expect(page.getByText('Ministerio de Obras Publicas')).toBeVisible();
  });

  test('sidebar has navigation links', async ({ page }) => {
    await expect(page.getByRole('link', { name: /dashboard/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /solicitudes/i })).toBeVisible();
  });
});

test.describe('MOP Portal UI Elements', () => {
  test.skip('Check MOP portal visual elements', async ({ page }) => {
    // This test requires authentication
    await page.goto('/mop');

    // Sidebar
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.getByText('MOP Portal')).toBeVisible();

    // Main content area
    await expect(page.locator('main')).toBeVisible();
  });
});
