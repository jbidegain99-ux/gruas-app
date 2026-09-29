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
import { readFileSync } from 'node:fs';
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
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
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

// ---------- comandos ----------
async function reset({ silencioso = false } = {}) {
  const di = (m) => { if (!silencioso) console.log(m); };
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
  await patch('operator_locations', `operator_id=in.(${ids.join(',')})`, {
    is_online: true, updated_at: new Date().toISOString(),
  });
  console.log(`\n  Flota al día: ${ids.length} operadores transmitiendo ahora mismo.`);
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
  console.log(`\n  Contraseña de todas: ${PASS}\n`);
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

  // --- 3. el ciclo real de cada servicio ---
  const tokens = {};
  for (const g of GENTE) tokens[g.key] = await login(g.email);

  const crear = async (e) => {
    const o = P[e.origen], d = P[e.destino || e.origen];
    const r = await rpc(tokens[e.cliente], 'create_service_request', {
      p_pickup_lat: o.lat, p_pickup_lng: o.lng, p_pickup_address: o.dir,
      p_dropoff_lat: d.lat, p_dropoff_lng: d.lng, p_dropoff_address: d.dir,
      p_incident_type: e.incidente, p_notes: null,
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
  // Y una esperando operador, para que el pool no esté vacío.
  const pool = await crear({ cliente: 'silvia', servicio: 'tow', km: 8.1, origen: 'escalon', destino: 'bosch', incidente: 'Se quedó sin frenos' });
  console.log('.\n  5 completados · 1 cancelado · 1 en sitio · 1 en camino · 1 esperando');

  // --- 4. correr los relojes hacia atrás ---
  // Lo unico fabricado. Se mueven los timestamps de la solicitud Y los de sus
  // eventos, porque de esos dos sale la linea de tiempo y la medicion de SLA: si
  // se moviera solo la solicitud, el caso diria "22 min a la llegada" con una
  // linea de tiempo donde todo pasó en el mismo segundo.
  console.log('· corriendo los relojes hacia atrás');
  const ahora = Date.now();
  const backdate = async (requestId, t0, tAsign, tLleg, tFin) => {
    await patch('service_requests', `id=eq.${requestId}`, {
      created_at: iso(t0), updated_at: iso(tFin ?? tLleg ?? tAsign ?? t0),
      ...(tAsign ? { assigned_at: iso(tAsign) } : {}),
      ...(tLleg ? { activated_at: iso(tLleg) } : {}),
      ...(tFin ? { completed_at: iso(tFin) } : {}),
    });
    await patch('cases', `request_id=eq.${requestId}`, { created_at: iso(t0) });
    const enRuta = tAsign && tLleg ? tAsign + (tLleg - tAsign) * 0.25 : null;
    const mapa = [
      ['REQUEST_CREATED', t0], ['COVERAGE_CHECKED', t0],
      ['OPERATOR_ACCEPTED', tAsign], ['PIN_VERIFIED', tLleg],
      ['PRICE_COMPUTED', tFin], ['USER_CANCELLED', tFin ?? t0],
    ];
    for (const [tipo, cuando] of mapa) {
      if (cuando) await patch('request_events', `request_id=eq.${requestId}&event_type=eq.${tipo}`, { created_at: iso(cuando) });
    }
    // STATUS_CHANGED aparece varias veces (en_route, completed). Se reparte:
    // el primero al salir, el ultimo al cerrar.
    if (enRuta) await patch('request_events', `request_id=eq.${requestId}&event_type=eq.STATUS_CHANGED&created_at=lt.${iso(ahora)}`, { created_at: iso(tFin ?? enRuta) });
  };

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
  await backdate(pool.id, ahora - min(4), null, null, null);

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
  if (sla) console.log(`  Cobertura de Carla en una grúa de $85: la póliza asume $${sla.amount_covered} y ella paga $${sla.amount_copay}`);
  console.log(`\n  Entrar como aseguradora: aseguradora@segurosdemo.sv / Insurer123!`);
  console.log(`  Entrar como cliente u operador: <nombre>${DOMINIO} / ${PASS}\n`);
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
    // asi que un socio comun no podria tomar el servicio. El seed de hoy no crea
    // ninguno.
    const provs = [...new Set(perfiles.filter((p) => p.role === 'OPERATOR' && p.provider_id).map((p) => p.provider_id))];
    const mopt = provs.length ? await sel('providers', `id=in.(${provs.join(',')})&is_mopt=eq.true&select=id`) : [];
    const zonas = mopt.length ? await sel('mopt_zones', `provider_id=in.(${mopt.map((m) => m.id).join(',')})&is_active=eq.true&select=name,polygon,provider_id`) : [];
    if (!zonas.length) {
      console.log('\n  ⚠ El escenario de la demo no tiene zona MOPT con socios propios: sigo en San Salvador (--mopt ignorado).');
    } else {
      const pts = zonas[0].polygon; // [[lat, lng], ...]
      const c = pts.reduce((a, [la, ln]) => ({ lat: a.lat + la / pts.length, lng: a.lng + ln / pts.length }), { lat: 0, lng: 0 });
      origen = { lat: c.lat, lng: c.lng, dir: `${zonas[0].name} (zona MOPT)` };
      destino = { lat: c.lat + 0.025, lng: c.lng + 0.01, dir: `${zonas[0].name}, tramo norte` };
      sociosMopt = zonas[0].provider_id;
    }
  }

  // --- elenco libre: la primera clienta sin servicio en curso y el socio libre mas cercano ---
  const cliente = ['carla', 'rodrigo', 'silvia']
    .map((k) => perfiles.find((p) => p.email === k + DOMINIO))
    .find((p) => p && !ocupado(p.id));
  if (!cliente) { console.log('\n  Los tres clientes de la demo tienen un servicio en curso. Ciérralos o corre pnpm demo:seed.\n'); return; }
  const locs = await sel('operator_locations', `operator_id=in.${lista}&select=operator_id,lat,lng`);
  const socios = perfiles
    .filter((p) => p.role === 'OPERATOR' && p.verification_status === 'approved' && !ocupado(p.id))
    .filter((p) => !sociosMopt || p.provider_id === sociosMopt)
    .map((p) => ({ ...p, loc: locs.find((l) => l.operator_id === p.id) }))
    .sort((a, b) => (a.loc ? kmEntre(a.loc, origen) : 99) - (b.loc ? kmEntre(b.loc, origen) : 99));
  if (!socios.length) { console.log('\n  No hay socios de la demo libres (todos con un servicio en curso). Corre pnpm demo:seed.\n'); return; }

  const tCliente = await login(cliente.email);
  const nombre = (p) => p.full_name.split(' ')[0];

  console.log(`\n  ▶ Demo en vivo · ${rapido ? 'rápida (1 s por paso)' : 'normal (2 s por paso)'} · Ctrl+C cancela la solicitud`);
  console.log('    Míralo mientras corre:  http://localhost:3000/admin/fleet  ·  http://localhost:3000/admin/requests\n');

  // --- 1. la solicitud ---
  const r = await rpc(tCliente, 'create_service_request', {
    p_pickup_lat: origen.lat, p_pickup_lng: origen.lng, p_pickup_address: origen.dir,
    p_dropoff_lat: destino.lat, p_dropoff_lng: destino.lng, p_dropoff_address: destino.dir,
    p_incident_type: 'Vehículo no enciende', p_notes: 'Servicio de demostración (demo:drive)',
    p_service_type: 'tow', p_tow_type: 'light', p_service_details: {}, p_vehicle_photo_url: null,
  });
  if (!r?.success) throw new Error(`no se pudo crear la solicitud: ${JSON.stringify(r).slice(0, 200)}`);
  const id = r.request_id || r.id;
  const pin = String(r.pin);
  const t0 = Date.now();
  const [caso] = await sel('cases', `request_id=eq.${id}&select=folio`);
  const folio = caso?.folio || id.slice(0, 8);

  // Ctrl+C a mitad: la clienta cancela (misma RPC que la app), para no dejar un
  // servicio colgado que despues bloquee el siguiente `drive`.
  let terminado = false, cortando = false;
  const cancelar = (motivo) => rpc(tCliente, 'cancel_service_request', { p_request_id: id, p_reason: motivo });
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
    console.log(`  Clienta / socio   ${cliente.full_name} · ${socio.full_name}`);
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
    console.log('');
  } catch (e) {
    // Si algo revienta a mitad, tampoco se deja el servicio colgado.
    if (!terminado) await cancelar('Demo fallida (demo:drive)').catch(() => {});
    throw e;
  }
}

// ---------- main ----------
const cmd = process.argv[2] || 'status';
const acciones = { seed, reset, status, ping, drive };
if (!acciones[cmd]) {
  console.error('\n  uso: node scripts/demo.mjs seed | reset | status | ping | drive [--speed=rapido|normal] [--mopt]\n');
  process.exit(1);
}
acciones[cmd]().catch((e) => { console.error('\n  ✗', e.message, '\n'); process.exit(1); });
