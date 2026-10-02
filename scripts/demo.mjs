#!/usr/bin/env node
// =====================================================================
// B-18 — Modo demo / sandbox para ventas
//
//   node scripts/demo.mjs seed     arma el escenario
//   node scripts/demo.mjs reset    lo borra entero
//   node scripts/demo.mjs status   dice que hay puesto
//   node scripts/demo.mjs ping     le pone la hora a la flota de la demo
//   node scripts/demo.mjs drive    simula EN VIVO un servicio completo (VEN-01)
//                                  [--speed=rapido|normal] [--mopt]
//   node scripts/demo.mjs code     código 2FA del dueño del portal MOPT de la demo
//
// Contra el entorno de demo (scripts/demo-env.mjs) va con DEMO_SUPABASE_URL;
// sin ella, contra la base local de desarrollo.
//
// Por que existe: los cuatro entregables de la Fase 2 estaban codeados pero
// nunca se habian visto FUNCIONANDO, porque a la base le faltaban los datos que
// los alimentan. Con la base de pruebas, el portal mostraba SLA de "0 s" (los
// casos sembrados tenian todos los timestamps iguales), el mapa de flota estaba
// vacio y `suggest_nearest_operators` devolvia cero candidatos, porque
// `operator_locations` no tenia una sola fila. Mostrarle eso a una aseguradora
// se lee como que la metrica esta rota, no como que somos rapidos.
//
// Como se arma, y por que asi: los servicios NO se insertan a mano. Se ejecuta
// el ciclo real —create_service_request, accept, en_route, verify_request_pin,
// complete_service_request, rate_service— con el JWT de cada persona, y recien
// despues se corren los timestamps hacia atras. Asi el folio, la linea de
// tiempo, el precio y el consumo de la poliza los produce el sistema de verdad;
// lo unico fabricado son las fechas. Si manana cambia una regla de negocio, el
// escenario cambia con ella en vez de quedar mintiendo.
//
// Todo lo que crea lleva el dominio @demo.budi.sv, y `reset` borra exactamente
// eso: no toca las cuentas de prueba ni los datos que ya tengas.
// =====================================================================
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { totp } from './lib-totp.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOMINIO = '@demo.budi.sv';
const PASS = 'Demo1234!';

// ---------- entorno ----------
const env = Object.fromEntries(
  readFileSync(join(RAIZ, 'apps/web/.env.local'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
// Si el entorno de demo (scripts/demo-env.mjs) está arriba, los comandos van a
// él solos —el día de la demo, `pnpm demo:ping` no tiene que tocar la base de
// desarrollo—; `--dev` fuerza la de desarrollo. Las claves locales de Supabase
// son las mismas en cualquier proyecto local.
const DEMO_API = 'http://127.0.0.1:58321';
const demoArriba = () => {
  try {
    return execFileSync('docker', ['ps', '--filter', 'name=supabase_db_budi-demo', '--format', '{{.Names}}']).toString().includes('budi-demo');
  } catch {
    return false;
  }
};
const URL = process.env.DEMO_SUPABASE_URL || (!process.argv.includes('--dev') && demoArriba() ? DEMO_API : env.NEXT_PUBLIC_SUPABASE_URL);
const BASE = URL === DEMO_API ? 'entorno de demo' : 'base de desarrollo';
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

// Guarda: esto siembra datos falsos y borra por dominio. No tiene nada que hacer
// contra el proyecto managed.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(URL || '')) {
  console.error(`\n  Este script es solo para la base LOCAL.\n  NEXT_PUBLIC_SUPABASE_URL apunta a: ${URL}\n`);
  process.exit(1);
}
if (!SERVICE) { console.error('Falta SUPABASE_SERVICE_ROLE_KEY en apps/web/.env.local'); process.exit(1); }

// ---------- helpers ----------
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
  api(`/rest/v1/${t}`, { method: 'POST', body: JSON.stringify(body), headers: { Prefer: 'return=representation' } });

async function login(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${email}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}
async function rpc(token, fn, args = {}) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const txt = await r.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt; }
  if (r.status >= 400) throw new Error(`${fn} -> ${r.status} ${txt.slice(0, 250)}`);
  return body;
}
async function setStatus(token, id, status) {
  const r = await fetch(`${URL}/rest/v1/service_requests?id=eq.${id}`, {
    method: 'PATCH',
    // return=minimal: el socio no puede leer la fila entera (pin_hash), asi que
    // no se le pide de vuelta.
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status }),
  });
  if (r.status >= 400) throw new Error(`status ${status} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
}

const min = (n) => n * 60_000;
const hrs = (n) => n * 3_600_000;
const dias = (n) => n * 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

// ---------- el elenco ----------
const GENTE = [
  { key: 'carla',    email: 'carla' + DOMINIO,    nombre: 'Carla Mejía',      tel: '+503 7811-2200', rol: 'USER' },
  { key: 'rodrigo',  email: 'rodrigo' + DOMINIO,  nombre: 'Rodrigo Cruz',     tel: '+503 7811-2201', rol: 'USER' },
  { key: 'silvia',   email: 'silvia' + DOMINIO,   nombre: 'Silvia Portillo',  tel: '+503 7811-2202', rol: 'USER' },
  { key: 'nelson',   email: 'nelson' + DOMINIO,   nombre: 'Nelson Alvarado',  tel: '+503 7811-2210', rol: 'OPERATOR', empresa: 'Grúas El Salvador S.A. de C.V.' },
  { key: 'wilfredo', email: 'wilfredo' + DOMINIO, nombre: 'Wilfredo Rivas',   tel: '+503 7811-2211', rol: 'OPERATOR', empresa: 'Grúas Pesadas del Pacífico' },
  { key: 'mauricio', email: 'mauricio' + DOMINIO, nombre: 'Mauricio Chávez',  tel: '+503 7811-2212', rol: 'OPERATOR', empresa: 'Servicios de Grúas Rápidas' },
  { key: 'beto',     email: 'beto' + DOMINIO,     nombre: 'Alberto Guzmán',   tel: '+503 7811-2213', rol: 'OPERATOR', empresa: 'Grúas El Salvador S.A. de C.V.' },
];

// Puntos reales del área metropolitana, para que el mapa y las rutas den números creíbles.
const P = {
  heroes:     { lat: 13.7008, lng: -89.2246, dir: 'Boulevard de los Héroes, San Salvador' },
  escalon:    { lat: 13.7024, lng: -89.2436, dir: 'Colonia Escalón, San Salvador' },
  roosevelt:  { lat: 13.7010, lng: -89.2154, dir: 'Alameda Roosevelt, San Salvador' },
  merliot:    { lat: 13.6742, lng: -89.2836, dir: 'Ciudad Merliot, Santa Tecla' },
  autofix:    { lat: 13.6731, lng: -89.2897, dir: 'Taller Autofix, Santa Tecla' },
  bosch:      { lat: 13.6795, lng: -89.2712, dir: 'Taller Bosch, Antiguo Cuscatlán' },
  soyapango:  { lat: 13.7100, lng: -89.1400, dir: 'Boulevard del Ejército, Soyapango' },
  sanmiguel:  { lat: 13.6550, lng: -89.2550, dir: 'Autopista a Comalapa, km 12' },
};

// created = hace cuánto se creó · asign/lleg/serv = minutos de cada tramo.
// El último cierra HOY a proposito: con todo en dias anteriores, el operador abre
// la app y ve "Cobras hoy $0.00" y el dashboard "Solicitudes hoy 0". Cierto, pero
// para una demo es una primera pantalla muerta.
// El objetivo de Seguros Demo es 10 min a asignación y 45 a llegada: el caso #4
// pasa los dos a propósito, para que el portal muestre un incumplimiento real y
// no una columna de "En tiempo" que no discrimina nada.
const GUION = [
  { id: 'c1', cliente: 'carla',   operador: 'nelson',   servicio: 'tow',      km: 11.4, origen: 'heroes',    destino: 'autofix', incidente: 'Vehículo no enciende',            creado: dias(6),  asign: 3,  lleg: 22, serv: 41, estrellas: 5, comentario: 'Llegó rapidísimo y muy amable.' },
  { id: 'c2', cliente: 'rodrigo', operador: 'wilfredo', servicio: 'tow',      km: 31.0, origen: 'soyapango', destino: 'autofix', incidente: 'Colisión leve en el bulevar',      creado: dias(4),  asign: 6,  lleg: 38, serv: 55, estrellas: 4, comentario: 'Todo bien, tardó un poco en llegar.' },
  { id: 'c3', cliente: 'carla',   operador: 'nelson',   servicio: 'locksmith', km: 0,   origen: 'escalon',   destino: null,      incidente: 'Llaves dentro del vehículo',       creado: dias(3),  asign: 2,  lleg: 14, serv: 18, estrellas: 5, comentario: 'Excelente servicio.' },
  { id: 'c4', cliente: 'rodrigo', operador: 'wilfredo', servicio: 'tow',      km: 18.6, origen: 'sanmiguel', destino: 'bosch',   incidente: 'Vehículo averiado en carretera',   creado: dias(2),  asign: 14, lleg: 58, serv: 46, estrellas: 3, comentario: 'Se tardaron bastante.' },
  { id: 'c5', cliente: 'silvia',  operador: 'nelson',   servicio: 'tire',     km: 0,    origen: 'roosevelt', destino: null,      incidente: 'Llanta ponchada',                  creado: hrs(6),   asign: 4,  lleg: 19, serv: 25, estrellas: 5, comentario: 'Muy rápido, gracias.' },
];

// Lo que queda vivo cuando se abre la demo.
const EN_CURSO = [
  { id: 'v1', cliente: 'carla',   operador: 'nelson',   servicio: 'tow',     km: 9.2, origen: 'merliot',   destino: 'bosch', incidente: 'No arranca después de la lluvia', creado: min(38), asign: 4, lleg: 26, hasta: 'active' },
  { id: 'v2', cliente: 'rodrigo', operador: 'wilfredo', servicio: 'battery', km: 0,   origen: 'roosevelt', destino: null,    incidente: 'Batería descargada',              creado: min(11), asign: 5, lleg: null, hasta: 'en_route' },
];

// ---------- correr los relojes hacia atrás ----------
// Lo unico fabricado. Se mueven los timestamps de la solicitud Y los de sus
// eventos, porque de esos dos sale la linea de tiempo y la medicion de SLA: si
// se moviera solo la solicitud, el caso diria "22 min a la llegada" con una
// linea de tiempo donde todo pasó en el mismo segundo.
async function correrRelojes(requestId, t0, tAsign, tLleg, tFin, ahora) {
  await patch('service_requests', `id=eq.${requestId}`, {
    created_at: iso(t0), updated_at: iso(tFin ?? tLleg ?? tAsign ?? t0),
    ...(tAsign ? { assigned_at: iso(tAsign) } : {}),
    ...(tLleg ? { activated_at: iso(tLleg) } : {}),
    ...(tFin ? { completed_at: iso(tFin) } : {}),
  });
  await patch('cases', `request_id=eq.${requestId}`, { created_at: iso(t0) });
  // "En camino": un cuarto del tramo entre la asignación y la llegada (o, si
  // todavía no llegó, un par de minutos después de aceptar).
  const enRuta = tAsign && tLleg ? tAsign + (tLleg - tAsign) * 0.25 : tAsign ? Math.min(tAsign + min(2), ahora) : null;
  const mapa = [
    ['REQUEST_CREATED', t0], ['COVERAGE_CHECKED', t0],
    ['OPERATOR_ACCEPTED', tAsign], ['OPERATOR_EN_ROUTE', enRuta], ['PIN_VERIFIED', tLleg],
    ['PRICE_COMPUTED', tFin], ['USER_CANCELLED', tFin ?? t0],
  ];
  for (const [tipo, cuando] of mapa) {
    if (cuando) await patch('request_events', `request_id=eq.${requestId}&event_type=eq.${tipo}`, { created_at: iso(cuando) });
  }
  // STATUS_CHANGED se reparte por el estado al que pasó (antes se filtraba
  // por fecha de creación y los eventos nuevos quedaban con la hora de hoy,
  // fuera de orden en la línea de tiempo).
  const porEstado = [['en_route', enRuta], ['active', tLleg], ['completed', tFin]];
  for (const [estado, cuando] of porEstado) {
    if (cuando) await patch('request_events', `request_id=eq.${requestId}&event_type=eq.STATUS_CHANGED&payload->>new_status=eq.${estado}`, { created_at: iso(cuando) });
  }
}

// El vehículo guardado de los clientes del escenario general (la app lo manda
// en la nota del pedido; 00157).
const autos = {
  carla:   { make: 'Honda', model: 'CR-V', color: 'Plateado', plate: 'P604117' },
  rodrigo: { make: 'Toyota', model: 'Hilux', color: 'Blanco', plate: 'P478302' },
  silvia:  { make: 'Mazda', model: '3', color: 'Rojo', plate: 'P915640' },
};

// ---------- comandos ----------
async function reset({ silencioso = false } = {}) {
  const di = (m) => { if (!silencioso) console.log(m); };
  // El programa MOPT de la demo primero: sus estados de cuenta y pagos
  // apuntan a cuentas de la demo.
  await resetMopt();
  const perfiles = await sel('profiles', `email=like.*${encodeURIComponent(DOMINIO)}&select=id,email`);
  if (!perfiles.length) { di('  no había nada de la demo puesto'); return 0; }
  const ids = perfiles.map((p) => p.id);
  const lista = `(${ids.join(',')})`;

  // El orden importa. Borrar la cuenta de auth NO alcanza: `request_events.actor_id`
  // apunta a `profiles` sin ON DELETE CASCADE, asi que mientras exista un evento
  // firmado por esta persona el DELETE del usuario revienta con un 23503. Primero
  // se van las solicitudes (que si arrastran sus eventos), y recien despues la
  // cuenta.
  const reqs = await sel('service_requests', `or=(user_id.in.${lista},operator_id.in.${lista})&select=id`);
  for (const r of reqs) await api(`/rest/v1/service_requests?id=eq.${r.id}`, { method: 'DELETE' });
  await api(`/rest/v1/operator_locations?operator_id=in.${lista}`, { method: 'DELETE' });
  await api(`/rest/v1/members?profile_id=in.${lista}`, { method: 'DELETE' });
  for (const p of perfiles) await api(`/auth/v1/admin/users/${p.id}`, { method: 'DELETE' });

  di(`  borradas ${perfiles.length} cuentas y ${reqs.length} servicios de la demo`);
  return perfiles.length;
}

// `suggest_nearest_operators` solo mira ubicaciones de los ultimos 5 minutos —y
// hace bien, no se despacha a alguien cuyo ultimo ping es de hace una hora—. Pero
// eso apaga la flota de la demo a los 5 minutos de sembrarla: el mapa sigue con
// pines y el despacho devuelve cero candidatos. Esto le vuelve a poner la hora.
async function ping() {
  const perfiles = await sel('profiles', `email=like.*${encodeURIComponent(DOMINIO)}&role=eq.OPERATOR&select=id`);
  if (!perfiles.length) { console.log('\n  La demo no está puesta.  ->  pnpm demo:seed\n'); return; }
  const ids = perfiles.map((p) => p.id);
  // Solo los que están en línea: el socio que la demo deja "sin señal" a
  // propósito sigue así.
  await patch('operator_locations', `operator_id=in.(${ids.join(',')})&is_online=eq.true`, {
    updated_at: new Date().toISOString(),
  });
  const vivos = await sel('operator_locations', `operator_id=in.(${ids.join(',')})&is_online=eq.true&select=operator_id`);
  console.log(`\n  Flota al día: ${vivos.length} operadores transmitiendo ahora mismo.`);
  console.log('  (correlo justo antes de mostrar la demo: el despacho solo mira los últimos 5 min)\n');
}

async function status() {
  const perfiles = await sel('profiles', `email=like.*${encodeURIComponent(DOMINIO)}&select=id,email,full_name,role`);
  if (!perfiles.length) { console.log('\n  La demo no está puesta.  ->  node scripts/demo.mjs seed\n'); return; }
  const ids = perfiles.map((p) => p.id);
  const reqs = await sel('service_requests', `user_id=in.(${ids.join(',')})&select=id,status,service_type,total_price`);
  const locs = await sel('operator_locations', `operator_id=in.(${ids.join(',')})&select=operator_id,is_online`);
  const porEstado = reqs.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  console.log(`\n  Demo puesta: ${perfiles.length} cuentas · ${reqs.length} servicios · ${locs.length} operadores en el mapa`);
  console.log(`  Estados: ${Object.entries(porEstado).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}\n`);
  perfiles.forEach((p) => console.log(`    ${p.role.padEnd(9)} ${p.email.padEnd(28)} ${p.full_name}`));
  const [mopt] = await sel('providers', `name=eq.${encodeURIComponent(MOPT_NOMBRE)}&is_mopt=eq.true&select=id`);
  console.log(mopt ? `\n  Programa MOPT de la demo: ${MOPT_NOMBRE}` : '\n  (sin programa MOPT de la demo)');
  cuentas();
}

async function seed() {
  console.log('\n· limpiando una demo anterior, si la había');
  await reset({ silencioso: true });

  // --- 1. cuentas ---
  console.log('· creando las cuentas');
  const ids = {};
  for (const g of GENTE) {
    const u = await api('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: g.email, password: PASS, email_confirm: true,
        user_metadata: { role: g.rol, full_name: g.nombre, phone: g.tel },
      }),
    });
    ids[g.key] = u.id;
  }
  const proveedores = await sel('providers', 'select=id,name');
  const idProveedor = (n) => proveedores.find((p) => p.name === n)?.id;
  for (const g of GENTE) {
    const campos = { full_name: g.nombre, phone: g.tel, role: g.rol };
    if (g.rol === 'OPERATOR') {
      campos.provider_id = idProveedor(g.empresa);
      campos.verification_status = 'approved';
    }
    await patch('profiles', `id=eq.${ids[g.key]}`, campos);
  }
  console.log(`  ${GENTE.length} cuentas (${PASS})`);

  // --- 2. afiliaciones ---
  // Carla al Plan Oro y Rodrigo al Básico: con dos planes distintos la demo
  // muestra por que el copago cambia de una persona a otra.
  const polizas = await sel('policies', 'select=id,policy_number');
  const idPoliza = (n) => polizas.find((p) => p.policy_number === n)?.id;
  await ins('members', [
    { policy_id: idPoliza('POL-2026-0001'), profile_id: ids.carla,   document_number: '04521879-3', full_name: 'Carla Mejía',  phone: '+503 7811-2200', relationship: 'holder', starts_on: '2026-01-01' },
    { policy_id: idPoliza('POL-2026-0002'), profile_id: ids.rodrigo, document_number: '05918342-7', full_name: 'Rodrigo Cruz', phone: '+503 7811-2201', relationship: 'holder', starts_on: '2026-01-01' },
  ]);
  console.log('  Carla afiliada al Plan Oro · Rodrigo al Básico · Silvia sin seguro');

  // Su vehículo guardado (la app lo manda en la nota del pedido; 00157).
  for (const [k, v] of Object.entries(autos)) await ins('vehicles', { user_id: ids[k], ...v, is_default: true });

  // --- 3. el ciclo real de cada servicio ---
  const tokens = {};
  for (const g of GENTE) tokens[g.key] = await login(g.email);
  for (const g of GENTE.filter((x) => x.rol === 'OPERATOR')) await rpc(tokens[g.key], 'complete_partner_practice');

  const crear = async (e) => {
    const o = P[e.origen], d = P[e.destino || e.origen];
    const r = await rpc(tokens[e.cliente], 'create_service_request', {
      p_pickup_lat: o.lat, p_pickup_lng: o.lng, p_pickup_address: o.dir,
      p_dropoff_lat: d.lat, p_dropoff_lng: d.lng, p_dropoff_address: d.dir,
      p_incident_type: e.incidente, p_notes: `Vehículo: ${rotulo(autos[e.cliente])}`,
      p_service_type: e.servicio, p_tow_type: 'light',
      p_service_details: {}, p_vehicle_photo_url: null,
    });
    if (!r?.success) throw new Error(`create ${e.id}: ${JSON.stringify(r).slice(0, 200)}`);
    return { id: r.request_id || r.id, pin: r.pin };
  };

  console.log('· corriendo el ciclo real de cada servicio');
  const hechos = [];
  for (const e of GUION) {
    const { id, pin } = await crear(e);
    await rpc(tokens[e.operador], 'accept_service_request', { p_request_id: id });
    await setStatus(tokens[e.operador], id, 'en_route');
    await rpc(tokens[e.operador], 'verify_request_pin', { p_request_id: id, p_pin: String(pin) });
    await rpc(tokens[e.operador], 'complete_service_request', { p_request_id: id, p_distance_pickup_to_dropoff: e.km });
    await rpc(tokens[e.cliente], 'rate_service', { p_request_id: id, p_stars: e.estrellas, p_comment: e.comentario });
    hechos.push({ ...e, requestId: id });
    process.stdout.write('.');
  }

  // Una cancelada, por el camino de verdad (la misma RPC que usa la app).
  const canc = await crear({ cliente: 'silvia', servicio: 'mechanic', origen: 'roosevelt', destino: null, incidente: 'Ruido en el motor' });
  await rpc(tokens.silvia, 'cancel_service_request', { p_request_id: canc.id, p_reason: 'El cliente resolvió por su cuenta' });
  process.stdout.write('.');

  const vivos = [];
  for (const e of EN_CURSO) {
    const { id, pin } = await crear(e);
    await rpc(tokens[e.operador], 'accept_service_request', { p_request_id: id });
    await setStatus(tokens[e.operador], id, 'en_route');
    if (e.hasta === 'active') await rpc(tokens[e.operador], 'verify_request_pin', { p_request_id: id, p_pin: String(pin) });
    vivos.push({ ...e, requestId: id });
    process.stdout.write('.');
  }
  // Ninguna "esperando operador": a los 10 minutos dispararía la alerta de
  // solicitud sin atender en todas las pantallas del admin. Se pide en vivo.
  console.log('.\n  5 completados · 1 cancelado · 1 en sitio · 1 en camino');

  // --- 4. correr los relojes hacia atrás ---
  // Lo unico fabricado. Se mueven los timestamps de la solicitud Y los de sus
  // eventos, porque de esos dos sale la linea de tiempo y la medicion de SLA: si
  // se moviera solo la solicitud, el caso diria "22 min a la llegada" con una
  // linea de tiempo donde todo pasó en el mismo segundo.
  console.log('· corriendo los relojes hacia atrás');
  const ahora = Date.now();
  const backdate = (requestId, t0, tAsign, tLleg, tFin) => correrRelojes(requestId, t0, tAsign, tLleg, tFin, ahora);

  for (const e of hechos) {
    const t0 = ahora - e.creado;
    const tA = t0 + min(e.asign), tL = tA + min(e.lleg), tF = tL + min(e.serv);
    await backdate(e.requestId, t0, tA, tL, tF);
    await patch('ratings', `request_id=eq.${e.requestId}`, { created_at: iso(tF + min(6)) });
    await patch('coverage_usage', `request_id=eq.${e.requestId}`, { used_on: iso(tF).slice(0, 10), created_at: iso(tF) });
  }
  for (const e of vivos) {
    const t0 = ahora - e.creado;
    const tA = t0 + min(e.asign);
    await backdate(e.requestId, t0, tA, e.lleg ? tA + min(e.lleg) : null, null);
  }
  await backdate(canc.id, ahora - hrs(9), null, null, ahora - hrs(9) + min(7));

  // --- 5. la flota en el mapa ---
  // Sin esto el mapa de Flota queda vacio y suggest_nearest_operators devuelve
  // cero candidatos: es la tabla de la que cuelgan los dos.
  console.log('· poniendo la flota en el mapa');
  // Solo operadores de la demo: si se tocaran los de siempre, `reset` dejaria
  // pines huerfanos en el mapa y el escenario no seria reversible.
  const flota = [
    { id: ids.nelson,   lat: 13.6800, lng: -89.2750 }, // en servicio, cerca de Merliot
    { id: ids.wilfredo, lat: 13.7020, lng: -89.2190 }, // en camino, sobre Roosevelt
    { id: ids.mauricio, lat: 13.7062, lng: -89.2288 }, // libre, sobre los Héroes
    { id: ids.beto,     lat: 13.6884, lng: -89.2571 }, // libre, hacia Antiguo Cuscatlán
  ];
  for (const f of flota) {
    await api('/rest/v1/operator_locations', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        operator_id: f.id, lat: f.lat, lng: f.lng,
        heading: Math.floor(Math.random() * 360), speed: 0, accuracy: 8,
        is_online: true, updated_at: iso(ahora - min(1)),
      }),
    }).catch(async () => {
      await patch('operator_locations', `operator_id=eq.${f.id}`, {
        lat: f.lat, lng: f.lng, is_online: true, updated_at: iso(ahora - min(1)),
      });
    });
  }
  console.log(`  ${flota.length} operadores transmitiendo`);

  // --- 6. control ---
  const sla = await rpc(tokens.carla, 'preview_my_coverage', { p_service_type: 'tow', p_tow_type: 'light', p_km: 10, p_total: 85 }).catch(() => null);
  const cerca = await sel('operator_locations', 'is_online=eq.true&select=operator_id');
  console.log('\n  Listo.');
  console.log(`  Flota en línea: ${cerca.length}`);
  // Con las aseguradoras apagadas (00153) no hay cobertura que mostrar.
  if (sla && Number(sla.amount_covered) > 0) console.log(`  Cobertura de Carla en una grúa de $85: la póliza asume $${sla.amount_covered} y ella paga $${sla.amount_copay}`);
  await seedMopt();

  // Las push de toda la historia sembrada ya "pasaron": no tienen que salir
  // ahora ni quedar como atascadas en el panel del admin.
  const demo = await sel('profiles', `email=like.*${encodeURIComponent(DOMINIO)}&select=id`);
  await patch('notification_queue', `sent=eq.false&user_id=in.(${demo.map((p) => p.id).join(',')})`, { sent: true, sent_at: iso(Date.now()) });
  cuentas();
}

function cuentas() {
  console.log('\n  ─────────────────────────────────────────────');
  console.log(`  Contraseña de todas las cuentas: ${PASS}`);
  console.log(`  Admin de Budi           ${ADMIN.email}`);
  console.log(`  Portal MOPT, dueño      mopt.dueno${DOMINIO}   (pide 2FA: pnpm demo:code)`);
  console.log(`  Portal MOPT, analista   mopt.analista${DOMINIO}   (sin 2FA; ve todo, no aprueba ni paga)`);
  console.log(`  Socios MOPT (app)       josue · kevin · oscar · ricardo · marvin   ${DOMINIO}`);
  console.log(`  Usuarios (app)          daniela · luis · patricia · fernando · gabriela   ${DOMINIO}`);
  console.log('  ─────────────────────────────────────────────\n');
}

// Código 2FA del dueño del portal MOPT (el secreto lo guardó `seed` en .demo/).
async function code() {
  if (!existsSync(ARCHIVO_2FA)) { console.log('\n  No hay 2FA guardado. Corre pnpm demo:fresh (o pnpm demo:seed).\n'); return; }
  const f = JSON.parse(readFileSync(ARCHIVO_2FA, 'utf8'));
  const resta = 30 - (Math.floor(Date.now() / 1000) % 30);
  console.log(`\n  ${f.email}`);
  console.log(`  Código 2FA: ${totp(f.secret)}   (vale ${resta} s más)`);
  console.log('\n  Para tenerlo en el teléfono, carga este secreto en Google Authenticator');
  console.log(`  (Agregar código → Ingresar una clave): ${f.secret}\n`);
}

// ---------- escenario MOPT ----------
// Un programa de asistencia vial del MOPT con su flota propia, armado por los
// mismos caminos que usa Budi: alta institucional, contrato, zonas, tarifa,
// socios con su grúa, el portal con su dueño (2FA) y una analista, y tres
// meses de operación con el ciclo real de cada servicio. Encima, lo que el
// MOPT hace cada mes: estados de cuenta, reporte oficial y pagos a sus socios.
const MOPT_NOMBRE = 'MOPT — Programa de Asistencia Vial';
const DIR_DEMO = join(RAIZ, '.demo');
const ARCHIVO_2FA = join(DIR_DEMO, 'mopt-dueno-2fa.json');
const ADMIN = { email: 'admin@budi.sv', nombre: 'Administración Budi' };

const MOPT_GENTE = [
  // Portal del MOPT.
  { key: 'mDueno',    email: 'mopt.dueno' + DOMINIO,    nombre: 'Ing. Roberto Menjívar', tel: '+503 2528-3000', rol: 'USER', org: 'owner' },
  { key: 'mAnalista', email: 'mopt.analista' + DOMINIO, nombre: 'Lic. Karla Benítez',    tel: '+503 2528-3010', rol: 'USER', org: 'analyst' },
  // Socios de la flota del programa.
  { key: 'josue',   email: 'josue' + DOMINIO,   nombre: 'Josué Hernández',    tel: '+503 7720-4101', rol: 'OPERATOR', mopt: true, placa: 'C482915' },
  { key: 'kevin',   email: 'kevin' + DOMINIO,   nombre: 'Kevin Martínez',     tel: '+503 7720-4102', rol: 'OPERATOR', mopt: true, placa: 'C519304' },
  { key: 'oscar',   email: 'oscar' + DOMINIO,   nombre: 'Óscar Flores',       tel: '+503 7720-4103', rol: 'OPERATOR', mopt: true, placa: 'C537718' },
  { key: 'ricardo', email: 'ricardo' + DOMINIO, nombre: 'Ricardo Landaverde', tel: '+503 7720-4104', rol: 'OPERATOR', mopt: true, placa: 'C560142' },
  { key: 'marvin',  email: 'marvin' + DOMINIO,  nombre: 'Marvin Orellana',    tel: '+503 7720-4105', rol: 'OPERATOR', mopt: true, placa: 'C574409' },
  // Usuarios que piden en las zonas del programa.
  { key: 'daniela',  email: 'daniela' + DOMINIO,  nombre: 'Daniela Ramos',     tel: '+503 7811-3301', rol: 'USER' },
  { key: 'luis',     email: 'luis' + DOMINIO,     nombre: 'Luis Aguilar',      tel: '+503 7811-3302', rol: 'USER' },
  { key: 'patricia', email: 'patricia' + DOMINIO, nombre: 'Patricia Molina',   tel: '+503 7811-3303', rol: 'USER' },
  { key: 'fernando', email: 'fernando' + DOMINIO, nombre: 'Fernando Castillo', tel: '+503 7811-3304', rol: 'USER' },
  { key: 'gabriela', email: 'gabriela' + DOMINIO, nombre: 'Gabriela Rivas',    tel: '+503 7811-3305', rol: 'USER' },
];

const MOPT_ZONAS = [
  { nombre: 'Carretera al Puerto de La Libertad (CA-4)', poligono: [[13.48, -89.36], [13.48, -89.28], [13.62, -89.28], [13.62, -89.36]] },
  { nombre: 'Carretera del Litoral (CA-2), La Libertad', poligono: [[13.47, -89.45], [13.47, -89.36], [13.52, -89.36], [13.52, -89.45]] },
];

// Puntos reales sobre las dos carreteras (adentro de las zonas) y talleres de destino.
const PM = {
  zaragoza:  { lat: 13.5886, lng: -89.2893, dir: 'Km 21 Carretera al Puerto, Zaragoza' },
  km25:      { lat: 13.5703, lng: -89.2958, dir: 'Km 25 Carretera al Puerto de La Libertad' },
  km30:      { lat: 13.5462, lng: -89.3089, dir: 'Km 30 Carretera al Puerto, curva de Tepeagua' },
  tepeagua:  { lat: 13.5152, lng: -89.2974, dir: 'Tepeagua, Carretera al Puerto' },
  puerto:    { lat: 13.4905, lng: -89.3218, dir: 'Malecón del Puerto de La Libertad' },
  tunco:     { lat: 13.4935, lng: -89.3830, dir: 'Playa El Tunco, Carretera del Litoral' },
  sunzal:    { lat: 13.4995, lng: -89.3940, dir: 'Km 42 Carretera del Litoral, El Sunzal' },
  zonte:     { lat: 13.4950, lng: -89.4420, dir: 'Playa El Zonte, Carretera del Litoral' },
  tPuerto:   { lat: 13.4930, lng: -89.3190, dir: 'Taller Mecánico El Puerto, La Libertad' },
  tZaragoza: { lat: 13.5905, lng: -89.2870, dir: 'Taller Hermanos Pérez, Zaragoza' },
  tTecla:    { lat: 13.6731, lng: -89.2897, dir: 'Taller Autofix, Santa Tecla' },
};

// Plantilla de casos que se reparte en cada mes: servicio, recogida, destino,
// minutos a la asignación / llegada / servicio, estrellas y comentario.
// Dos casos pasan el SLA del contrato (10 min / 45 min) a propósito: un
// cumplimiento del 100 % no se cree.
const MOPT_CASOS = [
  ['tow',     'km25',     'tTecla',    3, 24, 38, 5, 'Llegó rápido y me explicó todo.'],
  ['battery', 'tunco',    null,        4, 18, 15, 5, 'Excelente, en minutos estaba andando.'],
  ['tow',     'km30',     'tPuerto',   6, 31, 29, 4, 'Buen servicio.'],
  ['tire',    'sunzal',   null,        2, 16, 20, 5, 'Muy amable el socio.'],
  ['tow',     'zaragoza', 'tZaragoza', 5, 22, 18, 5, 'Rápido y sin cobrarme nada.'],
  ['fuel',    'tepeagua', null,        3, 19, 10, 4, 'Todo bien.'],
  ['tow',     'zonte',    'tPuerto',  13, 52, 44, 3, 'Tardaron bastante en llegar.'],
  ['battery', 'puerto',   null,        2, 12, 14, 5, 'Excelente atención.'],
  ['tow',     'km25',     'tZaragoza', 4, 27, 25, 5, 'Muy profesional.'],
  ['tire',    'km30',     null,        7, 33, 22, 4, 'Bien, gracias.'],
  ['tow',     'tunco',    'tPuerto',   3, 21, 26, 5, 'Gracias por la ayuda.'],
  ['battery', 'zaragoza', null,        5, 17, 12, 5, 'Rapidísimo.'],
  ['tow',     'sunzal',   'tTecla',    9, 41, 47, 4, 'Llegó bien, el arrastre fue largo.'],
  ['fuel',    'zonte',    null,        4, 26, 9,  5, 'Me salvó la tarde.'],
];
// El vehículo guardado de cada Usuario. La app lo manda en la nota del pedido
// ("Vehículo: …") y la base lo pasa a las columnas del servicio (00157): así
// el MOPT ve marca, modelo y placa de lo que atendió.
const VEHICULOS = {
  daniela:  { make: 'Toyota', model: 'Corolla', color: 'Blanco', plate: 'P512883' },
  luis:     { make: 'Nissan', model: 'Frontier', color: 'Gris', plate: 'P338104' },
  patricia: { make: 'Kia', model: 'Picanto', color: 'Rojo', plate: 'P701256' },
  fernando: { make: 'Mitsubishi', model: 'L200', color: 'Negro', plate: 'P245977' },
  gabriela: { make: 'Hyundai', model: 'Tucson', color: 'Azul', plate: 'P889430' },
};
const rotulo = (v) => [[v.make, v.model, v.color].filter(Boolean).join(' '), v.plate].filter(Boolean).join(' · ');
const SOCIOS = ['josue', 'kevin', 'oscar', 'ricardo', 'marvin'];
const USUARIOS = ['daniela', 'luis', 'patricia', 'fernando', 'gabriela'];
const INCIDENTE = { tow: 'Vehículo varado en carretera', battery: 'Batería descargada', tire: 'Llanta ponchada', fuel: 'Sin combustible' };

// Hora de El Salvador (UTC-6, sin horario de verano).
const svPartes = (ms) => { const d = new Date(ms - hrs(6)); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; };
const svMs = (y, m, d, hh, mm) => Date.UTC(y, m, d, hh + 6, mm);
const mesClave = (y, m) => { const t = new Date(Date.UTC(y, m, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
const ultimoDia = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const fechaSv = (ms) => new Date(ms - hrs(6)).toISOString().slice(0, 10);

// Recorrido GPS creíble: puntos interpolados entre dos lugares, repartidos en
// el tiempo del tramo (el cálculo de km descarta saltos a más de 150 km/h).
const tramo = (a, b, desde, hasta, n = 12) => Array.from({ length: n }, (_, i) => {
  const t = i / (n - 1);
  const arco = Math.sin(t * Math.PI) * 0.08;
  return {
    lat: a.lat + (b.lat - a.lat) * t - (b.lng - a.lng) * arco,
    lng: a.lng + (b.lng - a.lng) * t + (b.lat - a.lat) * arco,
    recorded_at: iso(desde + (hasta - desde) * t),
  };
});

async function asegurarAdmin() {
  const [p] = await sel('profiles', `email=eq.${encodeURIComponent(ADMIN.email)}&select=id`);
  let id = p?.id;
  if (!id) {
    const u = await api('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: ADMIN.email, password: PASS, email_confirm: true, user_metadata: { role: 'USER', full_name: ADMIN.nombre } }),
    });
    id = u.id;
  }
  await patch('profiles', `id=eq.${id}`, { role: 'ADMIN', full_name: ADMIN.nombre });
  return login(ADMIN.email);
}

// Sesión con 2FA del dueño del portal: vincula un factor TOTP nuevo y guarda
// el secreto en .demo/ para que `demo.mjs code` dé el código el día de la demo
// (o para cargarlo en una app autenticadora).
async function loginDuenoMopt(email) {
  const token = await login(email);
  const h = { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const enr = await fetch(`${URL}/auth/v1/factors`, { method: 'POST', headers: h, body: JSON.stringify({ factor_type: 'totp', friendly_name: 'Demo Budi' }) }).then((r) => r.json());
  if (!enr.id) throw new Error(`2FA ${email}: ${JSON.stringify(enr).slice(0, 200)}`);
  const ch = await fetch(`${URL}/auth/v1/factors/${enr.id}/challenge`, { method: 'POST', headers: h, body: '{}' }).then((r) => r.json());
  const ver = await fetch(`${URL}/auth/v1/factors/${enr.id}/verify`, {
    method: 'POST', headers: h, body: JSON.stringify({ challenge_id: ch.id, code: totp(enr.totp.secret) }),
  }).then((r) => r.json());
  if (!ver.access_token) throw new Error(`2FA ${email}: ${JSON.stringify(ver).slice(0, 200)}`);
  mkdirSync(DIR_DEMO, { recursive: true });
  if (!existsSync(join(DIR_DEMO, '.gitignore'))) writeFileSync(join(DIR_DEMO, '.gitignore'), '*\n');
  writeFileSync(ARCHIVO_2FA, JSON.stringify({ email, secret: enr.totp.secret, uri: enr.totp.uri }, null, 2));
  return ver.access_token;
}

async function resetMopt() {
  const [prov] = await sel('providers', `name=eq.${encodeURIComponent(MOPT_NOMBRE)}&is_mopt=eq.true&select=id`);
  if (!prov) return;
  const [org] = await sel('organizations', `provider_id=eq.${prov.id}&select=id`);
  // Un estado de cuenta emitido es inmutable (la base no deja borrarlo, y hace
  // bien). Se revisa ANTES de tocar nada, para no dejar la demo a medias: el
  // programa MOPT de la demo se rehace con la base entera.
  const emitidos = org ? await sel('account_statements', `organization_id=eq.${org.id}&status=neq.draft&select=id`) : [];
  if (emitidos.length) {
    throw new Error('el programa MOPT de la demo tiene estados de cuenta emitidos, que no se pueden borrar.\n    Para rehacer la demo desde cero:  pnpm demo:fresh');
  }
  // Lo que no cuelga del programa por FK: pagos del libro y estados de cuenta.
  // La tarifa vigente no se borra (la base lo impide, y hace bien): sin el
  // programa queda una fila suelta que nadie lee.
  await api(`/rest/v1/ledger_payments?payer_id=eq.${prov.id}`, { method: 'DELETE' });
  if (org) await api(`/rest/v1/account_statements?organization_id=eq.${org.id}`, { method: 'DELETE' });
  await api(`/rest/v1/providers?id=eq.${prov.id}`, { method: 'DELETE' });
}

// ¿Algún otro programa MOPT ya cubre la Carretera al Puerto? Pasa en la base de
// desarrollo: ahí los pedidos de la demo caerían en ese programa y no en el de
// la demo (gana la zona más antigua).
const dentro = (p, poli) => {
  let adentro = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const [yi, xi] = poli[i], [yj, xj] = poli[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) adentro = !adentro;
  }
  return adentro;
};

async function seedMopt() {
  console.log('\n· armando el programa MOPT');
  const otras = await sel('mopt_zones', 'is_active=eq.true&select=name,polygon');
  const choca = otras.find((z) => Object.values(PM).some((p) => dentro(p, z.polygon)));
  if (choca) {
    console.log(`  ⚠ Se salta el escenario MOPT: en esta base, la zona "${choca.name}" de otro programa ya cubre la Carretera al Puerto.`);
    console.log('    El escenario MOPT completo va en el entorno de demo:  pnpm demo:fresh');
    return null;
  }
  const tAdmin = await asegurarAdmin();
  const ahora = Date.now();
  const hoy = svPartes(ahora);

  // --- alta institucional, contrato, SLA y zonas ---
  const org = await rpc(tAdmin, 'admin_create_institution', {
    p_type: 'MOPT', p_name: MOPT_NOMBRE, p_tax_id: '0614-010180-001-1',
    p_contact_name: 'Ing. Roberto Menjívar', p_contact_email: 'mopt.dueno' + DOMINIO, p_contact_phone: '+503 2528-3000',
  });
  const [prov] = await sel('providers', `name=eq.${encodeURIComponent(MOPT_NOMBRE)}&is_mopt=eq.true&select=id`);
  await rpc(tAdmin, 'admin_set_org_contract', {
    p_org: org, p_reference: 'MOPT-AV-2026-014', p_valid_from: `${hoy.y}-01-01`, p_valid_to: `${hoy.y}-12-31`,
    p_monthly_cap: 6000, p_on_cap: 'keep_courtesy',
    p_tariff_notes: 'Tarifario vigente de Budi; arrastre por kilómetro según el tipo de servicio.',
  });
  await rpc(tAdmin, 'admin_set_org_sla', { p_organization_id: org, p_assignment: 10, p_arrival: 45 });
  for (const z of MOPT_ZONAS) await ins('mopt_zones', { provider_id: prov.id, name: z.nombre, polygon: z.poligono, is_active: true });
  // La tarifa de plataforma rige desde que arrancó el contrato. La pantalla de
  // tarifas solo programa cambios a futuro, así que la vigente se carga directo.
  await ins('rate_versions', { kind: 'mopt_fee', subject_id: prov.id, rate: 5, valid_from: `${hoy.y}-01-01T06:00:00Z`, note: 'Contrato MOPT-AV-2026-014', created_by_name: ADMIN.nombre });

  // --- cuentas: portal, socios y Usuarios ---
  const ids = {};
  for (const g of MOPT_GENTE) {
    const u = await api('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: g.email, password: PASS, email_confirm: true, user_metadata: { role: g.rol, full_name: g.nombre, phone: g.tel } }),
    });
    ids[g.key] = u.id;
    await patch('profiles', `id=eq.${u.id}`, { full_name: g.nombre, phone: g.tel, role: g.rol });
  }
  for (const g of MOPT_GENTE.filter((x) => x.org)) {
    await rpc(tAdmin, 'admin_add_org_member', { p_organization_id: org, p_email: g.email, p_role: g.org });
  }
  for (const g of MOPT_GENTE.filter((x) => x.mopt)) {
    await patch('profiles', `id=eq.${ids[g.key]}`, { provider_id: prov.id, verification_status: 'approved' });
    await rpc(tAdmin, 'admin_set_operator_vehicle', { p_operator_id: ids[g.key], p_plate: g.placa, p_vehicle_type: 'tow_light', p_capacity_m3: null });
  }
  // El alta queda cerrada como la cerraría Budi: caso de prueba en la zona
  // (no crea servicios) y "alta completa".
  await rpc(tAdmin, 'admin_preview_eligibility', {
    p_org: org, p_service_type: 'tow', p_document: null, p_lat: PM.km25.lat, p_lng: PM.km25.lng, p_total: 100,
  });
  await rpc(tAdmin, 'admin_complete_onboarding', { p_org: org, p_notes: 'Programa en operación desde enero.' });
  // El programa opera desde enero: el alta, la organización, su equipo y las
  // cuentas llevan esa fecha (si no, el admin decía "alta completa en menos
  // de 1 h" de un programa con meses de historia).
  await patch('org_onboarding', `organization_id=eq.${org}`, {
    started_at: `${hoy.y}-01-05T15:00:00Z`, test_passed_at: `${hoy.y}-01-09T16:30:00Z`, completed_at: `${hoy.y}-01-12T17:00:00Z`,
  });
  await patch('organizations', `id=eq.${org}`, { created_at: `${hoy.y}-01-05T15:00:00Z` });
  await patch('organization_members', `organization_id=eq.${org}`, { created_at: `${hoy.y}-01-12T17:30:00Z` });
  await patch('profiles', `id=in.(${Object.values(ids).join(',')})`, { created_at: `${hoy.y}-01-14T16:00:00Z` });
  console.log(`  ${MOPT_NOMBRE}: 2 zonas, contrato con tope de $6,000/mes, 5 socios con su grúa, alta completa`);

  for (const [k, v] of Object.entries(VEHICULOS)) await ins('vehicles', { user_id: ids[k], ...v, is_default: true });

  const tok = {};
  for (const g of MOPT_GENTE.filter((x) => !x.org)) tok[g.key] = await login(g.email);
  // Socios con experiencia: la guía y la práctica ya hechas (si no, la app les
  // muestra "Aprende a usar Budi" como a un socio nuevo).
  for (const k of SOCIOS) await rpc(tok[k], 'complete_partner_practice');

  // --- tres meses de operación ---
  const casos = [];
  const agregarMes = (y, m, diasMes, n) => {
    for (let i = 0; i < n; i++) {
      const c = MOPT_CASOS[(i + m + 12) % MOPT_CASOS.length];
      const d = Math.min(diasMes[i % diasMes.length], ultimoDia(y, m));
      // Socio y Usuario con pasos distintos: si no, cada socio atendía siempre
      // a la misma persona.
      casos.push({ c, t0: svMs(y, m, d, 7 + ((i * 3) % 12), (i * 17) % 60), socio: SOCIOS[i % SOCIOS.length], cliente: USUARIOS[(i * 2 + m) % USUARIOS.length] });
    }
  };
  agregarMes(hoy.y, hoy.m - 2, [3, 6, 9, 12, 15, 18, 21, 24, 27], 9);
  agregarMes(hoy.y, hoy.m - 1, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28], 14);
  // Este mes: un caso cada dos días hasta ayer, y dos de hoy temprano.
  for (let d = 1, i = 0; d < hoy.d; d += 2, i++) {
    casos.push({ c: MOPT_CASOS[(i + 5) % MOPT_CASOS.length], t0: svMs(hoy.y, hoy.m, d, 8 + (i % 8), 20), socio: SOCIOS[(i + 2) % SOCIOS.length], cliente: USUARIOS[(i + 1) % USUARIOS.length] });
  }
  casos.push({ c: MOPT_CASOS[4], t0: ahora - hrs(4), socio: 'oscar', cliente: 'patricia' });
  casos.push({ c: MOPT_CASOS[1], t0: ahora - hrs(2), socio: 'ricardo', cliente: 'luis' });

  console.log(`· corriendo ${casos.length} servicios del programa con el ciclo real`);
  for (const k of casos) {
    const [servicio, ori, des, asign, lleg, serv, estrellas, comentario] = k.c;
    const o = PM[ori], d = des ? PM[des] : PM[ori];
    const r = await rpc(tok[k.cliente], 'create_service_request', {
      p_pickup_lat: o.lat, p_pickup_lng: o.lng, p_pickup_address: o.dir,
      p_dropoff_lat: d.lat, p_dropoff_lng: d.lng, p_dropoff_address: d.dir,
      p_incident_type: INCIDENTE[servicio], p_notes: `Vehículo: ${rotulo(VEHICULOS[k.cliente])}`,
      p_service_type: servicio, p_tow_type: 'light', p_service_details: {}, p_vehicle_photo_url: null,
    });
    if (!r?.success) throw new Error(`create MOPT: ${JSON.stringify(r).slice(0, 200)}`);
    if (r.mopt?.program_name !== MOPT_NOMBRE) throw new Error(`el servicio no quedó a cargo del MOPT: ${JSON.stringify(r).slice(0, 200)}`);
    const id = r.request_id || r.id;
    const km = des ? Math.round(kmEntre(o, d) * 1.25 * 10) / 10 : 0;
    await rpc(tok[k.socio], 'accept_service_request', { p_request_id: id });
    await setStatus(tok[k.socio], id, 'en_route');
    await rpc(tok[k.socio], 'verify_request_pin', { p_request_id: id, p_pin: String(r.pin) });
    await rpc(tok[k.socio], 'complete_service_request', { p_request_id: id, p_distance_pickup_to_dropoff: km });
    await rpc(tok[k.cliente], 'rate_service', { p_request_id: id, p_stars: estrellas, p_comment: comentario });

    const tA = k.t0 + min(asign), tL = tA + min(lleg), tF = tL + min(serv);
    await correrRelojes(id, k.t0, tA, tL, tF, ahora);
    await patch('ratings', `request_id=eq.${id}`, { created_at: iso(tF + min(8)) });
    // Recorrido: el socio llega desde ~3 km y, si es grúa, remolca al taller.
    const desde = { lat: o.lat + 0.022, lng: o.lng + 0.012 };
    const puntos = [...tramo(desde, o, tA + min(1), tL), ...(des ? tramo(o, d, tL + min(2), tF - min(1)) : [])];
    await ins('service_location_trail', puntos.map((p) => ({ request_id: id, ...p })));
    await api('/rest/v1/rpc/compute_case_km', { method: 'POST', body: JSON.stringify({ p_request_id: id }) });
    k.id = id;
    process.stdout.write('.');
  }
  console.log('');

  // --- en vivo: uno en sitio, uno en camino y uno esperando socio ---
  const vivo = async (cliente, socio, ori, des, servicio, hasta, creado, asign) => {
    const o = PM[ori], d = des ? PM[des] : PM[ori];
    const r = await rpc(tok[cliente], 'create_service_request', {
      p_pickup_lat: o.lat, p_pickup_lng: o.lng, p_pickup_address: o.dir, p_dropoff_lat: d.lat, p_dropoff_lng: d.lng, p_dropoff_address: d.dir,
      p_incident_type: INCIDENTE[servicio], p_notes: `Vehículo: ${rotulo(VEHICULOS[cliente])}`,
      p_service_type: servicio, p_tow_type: 'light', p_service_details: {}, p_vehicle_photo_url: null,
    });
    if (!r?.success) throw new Error(`create MOPT en vivo: ${JSON.stringify(r).slice(0, 200)}`);
    const id = r.request_id || r.id;
    const t0 = ahora - min(creado);
    if (socio) {
      await rpc(tok[socio], 'accept_service_request', { p_request_id: id });
      await setStatus(tok[socio], id, 'en_route');
      if (hasta === 'active') await rpc(tok[socio], 'verify_request_pin', { p_request_id: id, p_pin: String(r.pin) });
      const tA = t0 + min(asign);
      const tL = hasta === 'active' ? tA + min(19) : null;
      await correrRelojes(id, t0, tA, tL, null, ahora);
      // Lo que lleva recorrido: en sitio, la llegada entera; en camino, hasta donde va.
      const desde = { lat: o.lat + 0.022, lng: o.lng + 0.012 };
      const hasta_ = hasta === 'active' ? o : { lat: (desde.lat + o.lat) / 2, lng: (desde.lng + o.lng) / 2 };
      await ins('service_location_trail', tramo(desde, hasta_, tA + min(1), tL ?? ahora - min(1), 10).map((p) => ({ request_id: id, ...p })));
    } else {
      await correrRelojes(id, t0, null, null, null, ahora);
    }
    return id;
  };
  await vivo('daniela', 'josue', 'km30', 'tPuerto', 'tow', 'active', 41, 4);
  await vivo('gabriela', 'kevin', 'sunzal', null, 'battery', 'en_route', 12, 3);
  // Ninguno "esperando socio": a los 10 minutos dispararía la alerta de
  // solicitud sin atender en todas las pantallas del admin. El pedido nuevo
  // se hace en vivo durante la demo (app del Usuario o `demo:drive --mopt`).
  console.log('  ahora mismo: 1 en sitio · 1 en camino');

  // --- la flota en el mapa ---
  const enMapa = [
    ['josue', PM.km30, 1], ['kevin', { lat: PM.sunzal.lat + 0.011, lng: PM.sunzal.lng + 0.006 }, 1], ['oscar', PM.tepeagua, 1],
    ['ricardo', PM.zaragoza, 2],
    // Marvin quedó sin señal hace unas horas: el mapa lo muestra en gris.
    ['marvin', PM.puerto, 190],
  ];
  for (const [k, p, hace] of enMapa) {
    await api('/rest/v1/operator_locations', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ operator_id: ids[k], lat: p.lat, lng: p.lng, heading: 0, speed: 0, accuracy: 8, is_online: hace < 60, updated_at: iso(ahora - min(hace)) }),
    });
  }

  // --- lo que el MOPT hace cada mes ---
  const m2 = mesClave(hoy.y, hoy.m - 2), m1 = mesClave(hoy.y, hoy.m - 1);
  const rango = (clave) => { const [y, m] = clave.split('-').map(Number); return { from: `${clave}-01`, to: `${clave}-${String(ultimoDia(y, m - 1)).padStart(2, '0')}` }; };
  const tDueno = await loginDuenoMopt('mopt.dueno' + DOMINIO);
  const r2 = rango(m2), r1 = rango(m1);
  // Mes antepasado: emitido, aprobado por el MOPT y pagado (la tarifa a Budi).
  const ec2 = await rpc(tAdmin, 'admin_generate_statement', { p_org: org, p_from: r2.from, p_to: r2.to });
  await rpc(tAdmin, 'admin_issue_statement', { p_id: ec2 });
  await rpc(tAdmin, 'admin_generate_mopt_report', { p_mopt: prov.id, p_month: m2, p_send: false });
  await rpc(tDueno, 'approve_statement', { p_id: ec2 });
  await rpc(tAdmin, 'admin_mark_statement_paid', { p_id: ec2, p_paid_on: `${m1}-12`, p_reference: `TRF-MOPT-${m2.replace('-', '')}` });
  // Mes pasado: emitido, esperando que el MOPT lo apruebe (se aprueba en la demo).
  const ec1 = await rpc(tAdmin, 'admin_generate_statement', { p_org: org, p_from: r1.from, p_to: r1.to });
  await rpc(tAdmin, 'admin_issue_statement', { p_id: ec1 });
  await rpc(tAdmin, 'admin_generate_mopt_report', { p_mopt: prov.id, p_month: m1, p_send: false });

  // Pagos a los socios: el mes antepasado completo; del pasado, solo dos.
  const montos = async (clave) => {
    const lista = casos.filter((k) => fechaSv(k.t0).startsWith(clave)).map((k) => k.id);
    const filas = lista.length ? await sel('service_requests', `id=in.(${lista.join(',')})&select=operator_id,total_price`) : [];
    return filas.reduce((a, f) => ((a[f.operator_id] = (a[f.operator_id] || 0) + Number(f.total_price)), a), {});
  };
  const pagar = (opId, monto, dia, ref) => rpc(tAdmin, 'register_ledger_payment', {
    p_payer_kind: 'mopt', p_payer_id: prov.id, p_payee_kind: 'operator', p_payee_id: opId,
    p_amount: Math.round(monto * 100) / 100, p_paid_on: dia, p_reference: ref, p_note: null,
  });
  const clave = (k) => MOPT_GENTE.find((g) => ids[g.key] === k)?.key.toUpperCase() ?? 'SOCIO';
  for (const [opId, monto] of Object.entries(await montos(m2))) await pagar(opId, monto, `${m1}-08`, `TRF-${m2.replace('-', '')}-${clave(opId)}`);
  const pasado = await montos(m1);
  for (const k of ['josue', 'oscar']) if (pasado[ids[k]]) await pagar(ids[k], pasado[ids[k]], fechaSv(ahora), `TRF-${m1.replace('-', '')}-${k.toUpperCase()}`);
  console.log(`  ${m2}: estado de cuenta aprobado y pagado · ${m1}: emitido, falta que el MOPT lo apruebe`);
  console.log(`  reportes oficiales de ${m2} y ${m1} · pagos a socios: ${m2} completo, ${m1} parcial`);

  return { org, prov: prov.id };
}

// ---------- drive (VEN-01) ----------
// Una grua que se mueve de verdad, para mostrar en una reunion: una clienta de la
// demo pide el servicio, un socio de la demo lo toma y publica su ubicacion paso a
// paso con la misma RPC que usa la app (upsert_operator_location, que ademas graba
// service_location_trail mientras el servicio esta en_route o active), verifica
// el PIN, remolca hasta el destino, completa y la clienta califica. Nada se
// fabrica por SQL: es el ciclo real con el JWT de cada persona, y todo queda en
// las cuentas @demo.budi.sv (lo borra `reset`).
const ACTIVOS = ['initiated', 'assigned', 'en_route', 'active'];
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const kmEntre = (a, b) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// Ruta interpolada con un arco suave, para que en el mapa no parezca trazada con regla.
const ruta = (a, b, pasos) => Array.from({ length: pasos }, (_, i) => {
  const t = (i + 1) / pasos;
  const arco = Math.sin(t * Math.PI) * 0.12;
  return {
    lat: a.lat + (b.lat - a.lat) * t - (b.lng - a.lng) * arco,
    lng: a.lng + (b.lng - a.lng) * t + (b.lat - a.lat) * arco,
  };
});
const barra = (pct) => '█'.repeat(Math.round(pct / 5)).padEnd(20, '·');

async function drive() {
  const args = process.argv.slice(3);
  const rapido = args.some((a) => /^--speed=r[aá]pido$/i.test(a));
  const tic = rapido ? 1000 : 2000;

  const perfiles = await sel('profiles', `email=like.*${encodeURIComponent(DOMINIO)}&select=id,email,full_name,role,verification_status,provider_id`);
  if (!perfiles.length) { console.log('\n  La demo no está puesta.  ->  corre pnpm demo:seed\n'); return; }
  const lista = `(${perfiles.map((p) => p.id).join(',')})`;
  const ocupados = await sel('service_requests', `status=in.(${ACTIVOS.join(',')})&or=(user_id.in.${lista},operator_id.in.${lista})&select=user_id,operator_id`);
  const ocupado = (id) => ocupados.some((r) => r.user_id === id || r.operator_id === id);

  // --- escenario: San Salvador, o la zona MOPT si la demo tuviera flota MOPT ---
  let origen = { ...P.heroes }, destino = { ...P.bosch };
  let sociosMopt = null;
  if (args.includes('--mopt')) {
    // Solo hay zona MOPT "de la demo" si alguno de sus socios es de un programa
    // MOPT con zona activa: la flota del MOPT es cerrada (operator_fits_program),
    // asi que un socio comun no podria tomar el servicio. El seed arma la flota
    // del programa MOPT de la demo.
    const provs = [...new Set(perfiles.filter((p) => p.role === 'OPERATOR' && p.provider_id).map((p) => p.provider_id))];
    const mopt = provs.length ? await sel('providers', `id=in.(${provs.join(',')})&is_mopt=eq.true&select=id`) : [];
    const zonas = mopt.length ? await sel('mopt_zones', `provider_id=in.(${mopt.map((m) => m.id).join(',')})&is_active=eq.true&select=name,polygon,provider_id`) : [];
    if (!zonas.length) {
      console.log('\n  ⚠ El escenario de la demo no tiene zona MOPT con socios propios: sigo en San Salvador (--mopt ignorado).');
    } else {
      sociosMopt = zonas[0].provider_id;
      // Con el programa MOPT de la demo, lugares reales de su zona: varado en
      // la Carretera al Puerto y remolque a un taller de Santa Tecla. Con otro
      // programa, el centro de su primera zona.
      const [demoMopt] = await sel('providers', `name=eq.${encodeURIComponent(MOPT_NOMBRE)}&is_mopt=eq.true&select=id`);
      if (demoMopt?.id === sociosMopt) {
        origen = { lat: 13.5795, lng: -89.2921, dir: 'Km 23 Carretera al Puerto de La Libertad' };
        destino = { ...PM.tTecla };
      } else {
        const pts = zonas[0].polygon; // [[lat, lng], ...]
        const c = pts.reduce((a, [la, ln]) => ({ lat: a.lat + la / pts.length, lng: a.lng + ln / pts.length }), { lat: 0, lng: 0 });
        origen = { lat: c.lat, lng: c.lng, dir: `${zonas[0].name} (zona MOPT)` };
        destino = { lat: c.lat + 0.025, lng: c.lng + 0.01, dir: `${zonas[0].name}, tramo norte` };
      }
    }
  }

  // --- elenco libre: la primera clienta sin servicio en curso y el socio libre mas cercano ---
  // En la zona MOPT pide un Usuario del programa; si no, los del escenario general.
  const candidatos = sociosMopt ? ['fernando', 'patricia', 'luis', 'daniela', 'gabriela'] : ['carla', 'rodrigo', 'silvia'];
  const cliente = candidatos
    .map((k) => perfiles.find((p) => p.email === k + DOMINIO))
    .find((p) => p && !ocupado(p.id));
  if (!cliente) { console.log('\n  Todos los clientes de la demo tienen un servicio en curso. Ciérralos o corre pnpm demo:fresh.\n'); return; }
  const locs = await sel('operator_locations', `operator_id=in.${lista}&select=operator_id,lat,lng`);
  const socios = perfiles
    .filter((p) => p.role === 'OPERATOR' && p.verification_status === 'approved' && !ocupado(p.id))
    .filter((p) => !sociosMopt || p.provider_id === sociosMopt)
    .map((p) => ({ ...p, loc: locs.find((l) => l.operator_id === p.id) }))
    .sort((a, b) => (a.loc ? kmEntre(a.loc, origen) : 99) - (b.loc ? kmEntre(b.loc, origen) : 99));
  if (!socios.length) { console.log('\n  No hay socios de la demo libres (todos con un servicio en curso). Corre pnpm demo:seed.\n'); return; }

  const tCliente = await login(cliente.email);
  const claveDe = (p) => p.email.replace(DOMINIO, '');
  const nombre = (p) => p.full_name.split(' ')[0];

  console.log(`\n  ▶ Demo en vivo · ${rapido ? 'rápida (1 s por paso)' : 'normal (2 s por paso)'} · Ctrl+C cancela la solicitud`);
  console.log(sociosMopt
    ? '    Míralo mientras corre:  http://localhost:3000/mopt/mapa  (portal MOPT)  ·  http://localhost:3000/admin/fleet\n'
    : '    Míralo mientras corre:  http://localhost:3000/admin/fleet  ·  http://localhost:3000/admin/requests\n');

  // --- 1. la solicitud ---
  const r = await rpc(tCliente, 'create_service_request', {
    p_pickup_lat: origen.lat, p_pickup_lng: origen.lng, p_pickup_address: origen.dir,
    p_dropoff_lat: destino.lat, p_dropoff_lng: destino.lng, p_dropoff_address: destino.dir,
    // Como la app: el vehículo guardado en la nota del pedido (00157).
    p_incident_type: 'Vehículo no enciende', p_notes: `Vehículo: ${rotulo(VEHICULOS[claveDe(cliente)] || autos[claveDe(cliente)])}\nServicio de demostración (demo:drive)`,
    p_service_type: 'tow', p_tow_type: 'light', p_service_details: {}, p_vehicle_photo_url: null,
  });
  if (!r?.success) throw new Error(`no se pudo crear la solicitud: ${JSON.stringify(r).slice(0, 200)}`);
  const id = r.request_id || r.id;
  const pin = String(r.pin);
  const t0 = Date.now();
  const [caso] = await sel('cases', `request_id=eq.${id}&select=folio`);
  const folio = caso?.folio || id.slice(0, 8);

  // Ctrl+C a mitad: se cancela para no dejar un servicio colgado que despues
  // bloquee el siguiente `drive`. Lo cancela el admin y no la clienta: desde
  // 00164 un servicio en curso (PIN verificado) ya no lo cancela el Usuario.
  let terminado = false, cortando = false;
  const tAdminDrive = await asegurarAdmin();
  const cancelar = async (motivo) => {
    const r = await rpc(tAdminDrive, 'admin_cancel_request', { p_request_id: id, p_reason: motivo });
    return { success: !!r, error: r ? null : 'sin respuesta' };
  };
  const alCortar = async () => {
    if (cortando) return;
    cortando = true;
    if (terminado) process.exit(130);
    console.log('\n\n  ■ Cortaste la demo: cancelando la solicitud…');
    try {
      const c = await cancelar('Demo interrumpida (demo:drive)');
      console.log(c?.success ? `  Solicitud ${folio} cancelada. No quedó nada colgado.\n` : `  No se pudo cancelar: ${c?.error}\n`);
    } catch (e) { console.log(`  No se pudo cancelar: ${e.message}\n`); }
    process.exit(130);
  };
  process.on('SIGINT', alCortar);
  process.on('SIGTERM', alCortar);

  try {
    console.log(`  1. ${cliente.full_name} pidió una grúa en ${origen.dir}.`);
    console.log(`     Folio ${folio} · PIN de confirmación ${pin} · destino: ${destino.dir}`);
    await esperar(tic * 2);

    // --- 2. un socio la toma ---
    let socio = null, tSocio = null;
    for (const s of socios) {
      const tok = await login(s.email);
      try { await rpc(tok, 'accept_service_request', { p_request_id: id }); socio = s; tSocio = tok; break; }
      catch (e) { if (!/no presta|otro programa/i.test(e.message)) throw e; }
    }
    if (!socio) throw new Error('ningún socio libre de la demo presta este servicio');
    const tAsign = Date.now();
    console.log(`  2. El socio ${socio.full_name} aceptó el servicio.`);
    await esperar(tic);

    await setStatus(tSocio, id, 'en_route');
    let aqui = socio.loc ? { lat: socio.loc.lat, lng: socio.loc.lng } : null;
    const dIni = aqui ? kmEntre(aqui, origen) : 0;
    // Si estaba casi encima (o lejisimos), arranca a ~3 km para que se le vea venir.
    if (!aqui || dIni < 1.5 || dIni > 12) aqui = { lat: origen.lat + 0.02, lng: origen.lng - 0.015 };
    console.log(`  3. ${nombre(socio)} sale hacia la recogida (a ${kmEntre(aqui, origen).toFixed(1)} km).`);

    const mover = async (tramo, rotulo) => {
      let ultimo = -100;
      for (let i = 0; i < tramo.length; i++) {
        await rpc(tSocio, 'upsert_operator_location', { p_lat: tramo[i].lat, p_lng: tramo[i].lng, p_is_online: true });
        const pct = Math.round(((i + 1) / tramo.length) * 100);
        // En terminal, una barra que se redibuja; redirigido a un archivo, una
        // linea cada 25 % para no llenarlo de retornos de carro.
        const tty = process.stdout.isTTY;
        if (pct - ultimo >= (tty ? 5 : 25) || i === tramo.length - 1) {
          process.stdout.write(`${tty ? '\r' : ''}     ${rotulo} ${barra(pct)} ${String(pct).padStart(3)} %${tty ? '   ' : '\n'}`);
          ultimo = pct;
        }
        if (i < tramo.length - 1) await esperar(tic);
      }
      if (process.stdout.isTTY) process.stdout.write('\n');
    };
    await mover(ruta(aqui, origen, 30), `El socio va en camino`);
    const tLleg = Date.now();

    // --- 3. llegada, PIN y remolque ---
    console.log(`  4. ${nombre(socio)} llegó. ${nombre(cliente)} le dicta el PIN ${pin}…`);
    await esperar(tic);
    await rpc(tSocio, 'verify_request_pin', { p_request_id: id, p_pin: pin });
    console.log('     PIN correcto: el servicio arrancó.');
    await esperar(tic);

    const kmTramo = Math.round(kmEntre(origen, destino) * 1.3 * 10) / 10; // recta -> carretera, aprox.
    await mover(ruta(origen, destino, 20), `Remolcando al destino `);
    await rpc(tSocio, 'complete_service_request', { p_request_id: id, p_distance_pickup_to_dropoff: kmTramo });
    const tFin = Date.now();
    console.log(`  5. Servicio completado en ${destino.dir} (${kmTramo} km de remolque).`);

    // --- 4. calificacion ---
    await esperar(tic);
    await rpc(tCliente, 'rate_service', { p_request_id: id, p_stars: 5, p_comment: 'Llegó rapidísimo, excelente servicio.' });
    terminado = true;
    console.log(`  6. ${nombre(cliente)} calificó al socio con ★★★★★.`);

    // --- resumen ---
    const [sr] = await sel('service_requests', `id=eq.${id}&select=status,total_price`);
    const [uso] = await sel('coverage_usage', `request_id=eq.${id}&select=amount_covered,amount_copay`);
    const puntos = await sel('service_location_trail', `request_id=eq.${id}&select=id`);
    const dur = (a, b) => { const s = Math.round((b - a) / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };
    const dinero = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
    console.log('\n  ─────────────────────────────────────────────');
    console.log(`  Folio             ${folio}   (estado: ${sr?.status})`);
    console.log(`  Usuario / socio   ${cliente.full_name} · ${socio.full_name}`);
    console.log(`  A la asignación   ${dur(t0, tAsign)}`);
    console.log(`  A la llegada      ${dur(tAsign, tLleg)}`);
    console.log(`  Servicio          ${dur(tLleg, tFin)}   ·   total ${dur(t0, tFin)}`);
    console.log(`  Precio            ${dinero(sr?.total_price)}${uso ? `   (el seguro cubre ${dinero(uso.amount_covered)}, copago ${dinero(uso.amount_copay)})` : ''}`);
    console.log(`  Recorrido         ${puntos.length} puntos GPS grabados`);
    console.log('  ─────────────────────────────────────────────');
    console.log('  Para mirarlo:');
    console.log('    http://localhost:3000/admin/requests');
    console.log('    http://localhost:3000/admin/fleet');
    if (uso) console.log('    http://localhost:3000/portal   (aseguradora@segurosdemo.sv / Insurer123!)');
    if (sociosMopt) console.log(`    http://localhost:3000/mopt/servicios/${id}   (cortesía del MOPT: el Usuario no pagó nada)`);
    console.log('');
  } catch (e) {
    // Si algo revienta a mitad, tampoco se deja el servicio colgado.
    if (!terminado) await cancelar('Demo fallida (demo:drive)').catch(() => {});
    throw e;
  }
}

// ---------- main ----------
const cmd = process.argv[2] || 'status';
const acciones = { seed, reset, status, ping, drive, code };
if (!acciones[cmd]) {
  console.error('\n  uso: node scripts/demo.mjs seed | reset | status | ping | drive [--speed=rapido|normal] [--mopt] | code\n');
  process.exit(1);
}
if (cmd !== 'code') console.log(`
  (${BASE}: ${URL})`);
acciones[cmd]().catch((e) => { console.error('\n  ✗', e.message, '\n'); process.exit(1); });
