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
// Se navega CLICKEANDO el tab bar, no con goto(). /history y /profile existen en
// (user) Y en (operator): con goto() expo-router cae siempre en el grupo de
// operador, asi que el smoke reportaba como USER pantallas que eran de OPERATOR.
// El click navega dentro del grupo correcto — lo que hace una persona de verdad.
//
// `tabs` son los tabBarLabel VISIBLES, que no siempre son el `title` de la ruta:
// el operador define 'Servicio Activo' -> 'Activo' y 'Mis Resenas' -> 'Resenas'.
async function authRun(role, email, pass, tabs) {
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
  let visited = 0;
  if (authed) {
    for (const [i, tab] of tabs.entries()) {
      // expo-router renderiza cada tab como <a role="tab">, no role="link".
      const target = page.getByRole('tab', { name: tab, exact: true }).last();
      if (!(await target.count())) { console.log(`  ✗ tab "${tab}" no esta en el tab bar`); continue; }
      await target.click();
      await page.waitForTimeout(3500);
      await page.screenshot({ path: `${OUT}/${role}-0${i + 1}-${tab.replace(/\W+/g, '')}.png` });
      visited++;
      // OJO: body.innerText incluye TODAS las pantallas montadas (react-native-web
      // no desmonta las inactivas), asi que no dice cual se esta viendo. El tab con
      // aria-selected si — y ademas verifica que el click navego a donde debia.
      const active = (await page.locator('[role="tab"][aria-selected="true"]').innerText().catch(() => '?')).trim();
      console.log(`  [${tab}] url=${page.url().replace(BASE, '')} -> ${active === tab ? 'OK' : `DESALINEADO (activo=${active})`}`);
    }
  }
  await ctx.close();
  return { authed, visited, total: tabs.length };
}

let userRun = null, opRun = null;
if (process.env.SKIP_AUTH !== '1') {
  userRun = await authRun('USER', process.env.USER_EMAIL || 'usuario1@gruas.sv', process.env.USER_PASS || 'User123!',
    ['Inicio', 'Solicitar', 'Historial', 'Perfil']);
  opRun = await authRun('OPERATOR', process.env.OP_EMAIL || 'operador1@gruas.sv', process.env.OP_PASS || 'Op123!',
    ['Solicitudes', 'Activo', 'Historial', 'Resenas', 'Perfil']);
}
const userAuthed = userRun && userRun.authed;
const opAuthed = opRun && opRun.authed;

// ---- Reporte ----
const real = allErrors.filter((e) => !KNOWN_WEB_NOISE.test(e.msg));
const moduleErrs = real.filter((e) => MODULE_ERR.test(e.msg));
const noise = allErrors.filter((e) => KNOWN_WEB_NOISE.test(e.msg));
console.log('\n========== RESUMEN ==========');
if (process.env.SKIP_AUTH !== '1') {
  console.log(`USER: auth=${userAuthed} tabs=${userRun.visited}/${userRun.total}`);
  console.log(`OPERATOR: auth=${opAuthed} tabs=${opRun.visited}/${opRun.total}`);
}
console.log(`errores de módulo/import (CRÍTICOS): ${moduleErrs.length}`);
moduleErrs.slice(0, 15).forEach((e) => console.log(`  ✗ [${e.role}] ${e.msg.slice(0, 200)}`));
console.log(`otros errores reales: ${real.length - moduleErrs.length}`);
real.filter((e) => !MODULE_ERR.test(e.msg)).slice(0, 10).forEach((e) => console.log(`  · [${e.role}] ${e.msg.slice(0, 160)}`));
console.log(`ruido web conocido (ignorable, p.ej. SecureStore): ${noise.length}`);

await browser.close();
const ok = moduleErrs.length === 0 && (process.env.SKIP_AUTH === '1' ||
  (userAuthed && opAuthed && userRun.visited === userRun.total && opRun.visited === opRun.total));
console.log(`\nVEREDICTO: ${ok ? 'PASS ✅' : 'REVISAR ⚠'}`);
process.exit(ok ? 0 : 1);
