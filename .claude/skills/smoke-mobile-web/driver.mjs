// Driver de Playwright para el smoke test de la app móvil vía Expo Web.
// Conduce un Chrome headless contra el dev server de Expo (http://localhost:8081),
// recorre pantallas públicas y autenticadas (USER + OPERATOR), captura screenshots
// y reporta errores de runtime (pageerror + console.error) — que es lo que delata
// imports rotos o módulos faltantes.
//
// Se ejecuta con cwd = apps/web (donde vive @playwright/test):
//   OUT_DIR=<dir-screenshots> node ../../.claude/skills/smoke-mobile-web/driver.mjs
//
// Env opcionales:
//   BASE       (default http://localhost:8081)
//   OUT_DIR    (requerido) carpeta donde escribir los .png
//   USER_EMAIL / USER_PASS       (default usuario1@gruas.sv / User123!)
//   OP_EMAIL   / OP_PASS         (default operador1@gruas.sv / Op123!)
//   SKIP_AUTH  ("1" para solo pantallas públicas)
import { createRequire } from 'module';
import { join } from 'path';
// @playwright/test se resuelve desde apps/web (cwd al ejecutar). Trae chromium.
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('@playwright/test');

const OUT = process.env.OUT_DIR;
const BASE = process.env.BASE || 'http://localhost:8081';
if (!OUT) { console.error('Falta OUT_DIR'); process.exit(2); }

const PHONE = { width: 390, height: 844 };
// channel:'chrome' usa el Chrome del sistema → no requiere descargar browsers de Playwright.
const browser = await chromium.launch({ channel: 'chrome', headless: true });

// Ruido conocido que NO indica un fallo de la reestructuración:
//  - expo-secure-store no existe en web (feature PIN) → "ExpoSecureStore... is not a function"
const KNOWN_WEB_NOISE = /ExpoSecureStore|SecureStore|getValueWithKeyAsync/i;
const MODULE_ERR = /cannot find module|unable to resolve|failed to resolve|is not defined|undefined is not|Element type is invalid|does not provide an export/i;

async function visit(page, label, path, waitMs = 6000) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(waitMs); // Expo web hidrata client-side / compila on-demand
  await page.screenshot({ path: `${OUT}/${label}.png` });
  const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  return text.slice(0, 220);
}

function watch(page, role, bag) {
  page.on('pageerror', (e) => bag.push({ role, kind: 'pageerror', msg: e.message }));
  page.on('console', (m) => { if (m.type() === 'error') bag.push({ role, kind: 'console', msg: m.text() }); });
}

const allErrors = [];

// ---- Pantallas públicas ----
{
  const ctx = await browser.newContext({ viewport: PHONE });
  const page = await ctx.newPage();
  watch(page, 'public', allErrors);
  console.log('## Pantallas públicas');
  for (const [label, path] of [['public-01-landing', '/'], ['public-02-login', '/login'], ['public-03-register', '/register']]) {
    console.log(`  ${path} -> ${await visit(page, label, path)}`);
  }
  await ctx.close();
}

// ---- Pantallas autenticadas ----
async function authRun(role, email, pass, routes) {
  const ctx = await browser.newContext({ viewport: PHONE });
  const page = await ctx.newPage();
  watch(page, role, allErrors);
  console.log(`\n## ${role}: ${email}`);
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(7000);
  await page.getByPlaceholder('tu@email.com').fill(email);
  await page.getByPlaceholder('Tu contraseña').fill(pass);
  await page.getByText('Iniciar Sesión', { exact: true }).last().click();
  await page.waitForTimeout(11000);
  const url = page.url();
  const authed = !/\/login$/.test(url);
  await page.screenshot({ path: `${OUT}/${role}-00-home.png` });
  console.log(`  login -> url=${url}  autenticado=${authed}`);
  if (authed) {
    for (const [i, r] of routes.entries()) {
      const t = await visit(page, `${role}-0${i + 1}-${r.replace(/\W+/g, '') || 'root'}`, r);
      console.log(`  ${r} -> ${t.slice(0, 110)}`);
    }
  }
  await ctx.close();
  return authed;
}

let userAuthed = null, opAuthed = null;
if (process.env.SKIP_AUTH !== '1') {
  userAuthed = await authRun('USER', process.env.USER_EMAIL || 'usuario1@gruas.sv', process.env.USER_PASS || 'User123!', ['/request', '/history', '/profile']);
  opAuthed = await authRun('OPERATOR', process.env.OP_EMAIL || 'operador1@gruas.sv', process.env.OP_PASS || 'Op123!', ['/active', '/ratings', '/profile']);
}

// ---- Reporte ----
const real = allErrors.filter((e) => !KNOWN_WEB_NOISE.test(e.msg));
const moduleErrs = real.filter((e) => MODULE_ERR.test(e.msg));
const noise = allErrors.filter((e) => KNOWN_WEB_NOISE.test(e.msg));
console.log('\n========== RESUMEN ==========');
if (process.env.SKIP_AUTH !== '1') console.log(`auth: USER=${userAuthed} OPERATOR=${opAuthed}`);
console.log(`errores de módulo/import (CRÍTICOS): ${moduleErrs.length}`);
moduleErrs.slice(0, 15).forEach((e) => console.log(`  ✗ [${e.role}] ${e.msg.slice(0, 200)}`));
console.log(`otros errores reales: ${real.length - moduleErrs.length}`);
real.filter((e) => !MODULE_ERR.test(e.msg)).slice(0, 10).forEach((e) => console.log(`  · [${e.role}] ${e.msg.slice(0, 160)}`));
console.log(`ruido web conocido (ignorable, p.ej. SecureStore): ${noise.length}`);

await browser.close();
const ok = moduleErrs.length === 0 && (process.env.SKIP_AUTH === '1' || (userAuthed && opAuthed));
console.log(`\nVEREDICTO: ${ok ? 'PASS ✅' : 'REVISAR ⚠'}`);
process.exit(ok ? 0 : 1);
