import { test, expect } from '@playwright/test';

test('homepage has title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Gruas App/);
});

test('homepage loads successfully', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});

test('login page loads', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('h1')).toContainText('Iniciar Sesion');
});

test('register page loads', async ({ page }) => {
  await page.goto('/register');
  await expect(page.locator('h1')).toContainText('Crear Cuenta');
});
