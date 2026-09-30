import { test, expect } from '@playwright/test';

test('homepage has title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Budi/);
});

test('homepage loads successfully', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toContainText(/grúa/i);
});

test('homepage covers the three audiences (LAN-10)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-SV');
  await expect(page.getByText('PIN de confirmación').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'MOPT', exact: true })).toBeVisible();
  // Aseguradoras y reaseguradoras en pausa (interruptor 00153, apagado hasta que
  // Walter avise): la landing no las muestra. Al prenderlo, volver a esperarlas.
  await expect(page.getByRole('heading', { level: 3, name: 'Aseguradoras', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 3, name: 'Reaseguradoras', exact: true })).toHaveCount(0);
  await expect(page.getByText('Agenda una demo')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Conoce cómo ser socio' })).toHaveAttribute('href', '/socios');
  const footer = page.getByRole('navigation', { name: 'Pie de página' });
  await expect(footer.getByRole('link', { name: 'Aviso de privacidad' })).toHaveAttribute('href', '/privacidad');
  await expect(footer.getByRole('link', { name: 'Eliminar mi cuenta' })).toHaveAttribute('href', '/eliminar-cuenta');
  await expect(footer.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Budi/);
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'es_SV');
});

test('login page loads', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('h1')).toContainText(/Iniciar sesi[oó]n/i);
});

test('register page loads', async ({ page }) => {
  await page.goto('/register');
  await expect(page.locator('h1')).toContainText(/crear cuenta/i);
});
