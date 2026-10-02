#!/usr/bin/env node
// =====================================================================
// Cuentas de prueba de la base LOCAL de desarrollo
//
//   pnpm dev:accounts
//
// Crea (o deja como deben estar) las cuentas de siempre: admin, soporte,
// usuario1 y dos socios operadores, con sus contraseñas, rol, empresa,
// verificación aprobada, práctica hecha y unidad con placa. Idempotente: se
// puede correr las veces que haga falta.
//
// Por qué existe: supabase/seed.sql no puede crear cuentas de Auth (corre antes
// de que existan), así que después de un `supabase db reset` —o de perder el
// volumen de la base— había que rehacerlas a mano. Las cuentas qa.* las crea
// `pnpm qa:cycle` y las de la demo `pnpm demo:seed`.
// =====================================================================
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(RAIZ, 'apps/web/.env.local'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
// Siempre la de desarrollo, aunque la demo esté arriba.
const URL = 'http://127.0.0.1:54321';
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE) { console.error('Falta SUPABASE_SERVICE_ROLE_KEY en apps/web/.env.local'); process.exit(1); }

const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function api(path, opts = {}) {
  const r = await fetch(`${URL}${path}`, { ...opts, headers: { ...svc, ...(opts.headers || {}) } });
  const txt = await r.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt; }
  if (r.status >= 400) throw new Error(`${opts.method || 'GET'} ${path} -> ${r.status} ${txt.slice(0, 300)}`);
  return body;
}
const sel = (t, q = '') => api(`/rest/v1/${t}?${q}`);
const patch = (t, q, body) =>
  api(`/rest/v1/${t}?${q}`, { method: 'PATCH', body: JSON.stringify(body), headers: { Prefer: 'return=minimal' } });
const ins = (t, body) =>
  api(`/rest/v1/${t}`, { method: 'POST', body: JSON.stringify(body), headers: { Prefer: 'return=minimal' } });

const CUENTAS = [
  { email: 'admin@gruas.sv', pass: 'Admin123!', rol: 'ADMIN', nombre: 'Administrador Sistema', tel: '+503 7000-0000' },
  { email: 'soporte@gruas.sv', pass: 'Soporte123!', rol: 'SUPPORT', nombre: 'Soporte Budi', tel: '+503 7000-0002' },
  { email: 'usuario1@gruas.sv', pass: 'User123!', rol: 'USER', nombre: 'Usuario Uno', tel: '+503 7000-0001',
    auto: { make: 'Toyota', model: 'Corolla', plate: 'P123456', color: 'Gris' } },
  { email: 'operador1@gruas.sv', pass: 'Op123!', rol: 'OPERATOR', nombre: 'Operador Uno', tel: '+503 7000-1111',
    empresa: '11111111-1111-1111-1111-111111111111', placa: 'C752301', unidad: 'tow_light' },
  { email: 'operador2@gruas.sv', pass: 'Op123!', rol: 'OPERATOR', nombre: 'Operador Dos', tel: '+503 7000-2222',
    empresa: '33333333-3333-3333-3333-333333333333', placa: 'C810442', unidad: 'tow_heavy' },
];

async function login(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${email}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

const usuarios = await api('/auth/v1/admin/users?per_page=1000');
for (const c of CUENTAS) {
  let id = usuarios.users.find((u) => u.email === c.email)?.id;
  // Desde 00096 el registro solo admite USER/OPERATOR: ADMIN y SUPPORT se crean
  // como USER y se promueven acá.
  const meta = { role: c.rol === 'OPERATOR' ? 'OPERATOR' : 'USER', full_name: c.nombre, phone: c.tel };
  if (id) {
    await api(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ password: c.pass, email_confirm: true }) });
  } else {
    id = (await api('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: c.email, password: c.pass, email_confirm: true, user_metadata: meta }),
    })).id;
  }
  const campos = { role: c.rol, full_name: c.nombre, phone: c.tel };
  if (c.rol === 'OPERATOR') Object.assign(campos, { provider_id: c.empresa, verification_status: 'approved' });
  await patch('profiles', `id=eq.${id}`, campos);

  if (c.auto && !(await sel('vehicles', `user_id=eq.${id}&select=id`)).length) {
    await ins('vehicles', { user_id: id, ...c.auto, is_default: true });
  }
  if (c.placa) {
    if (!(await sel('operator_vehicles', `operator_id=eq.${id}&select=id`)).length) {
      await ins('operator_vehicles', { operator_id: id, plate: c.placa, vehicle_type: c.unidad });
    }
    // La guía y la práctica del socio (AGT-05): sin esto la app lo frena antes
    // del primer servicio.
    const token = await login(c.email, c.pass);
    const r = await fetch(`${URL}/rest/v1/rpc/complete_partner_practice`, {
      method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (r.status >= 400) console.warn(`  práctica de ${c.email}: ${r.status} ${(await r.text()).slice(0, 150)}`);
  }
  console.log(`  ✓ ${c.email.padEnd(20)} ${c.pass.padEnd(12)} ${c.rol}`);
}

// El seed liga el DUI de usuario1 al padrón solo si la cuenta ya existe: se
// vuelve a correr ahora que existe (es idempotente).
execFileSync('docker', ['exec', '-i', 'supabase_db_gruas-app-revision', 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], {
  input: readFileSync(join(RAIZ, 'supabase/seed.sql')),
  stdio: ['pipe', 'ignore', 'inherit'],
});
console.log('  ✓ seed re-aplicado (DUI de usuario1 en el padrón)');
