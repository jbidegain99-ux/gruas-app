#!/usr/bin/env node
// =====================================================================
// B-18 — Modo demo / sandbox para ventas
//
//   node scripts/demo.mjs seed     arma el escenario
//   node scripts/demo.mjs reset    lo borra entero
//   node scripts/demo.mjs status   dice que hay puesto
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
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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

// ---------- main ----------
const cmd = process.argv[2] || 'status';
const acciones = { seed, reset, status, ping };
if (!acciones[cmd]) {
  console.error('\n  uso: node scripts/demo.mjs seed | reset | status\n');
  process.exit(1);
}
acciones[cmd]().catch((e) => { console.error('\n  ✗', e.message, '\n'); process.exit(1); });
