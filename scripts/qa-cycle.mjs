#!/usr/bin/env node
/**
 * Batería de negocio de punta a punta contra una base Supabase LOCAL.
 *
 *   pnpm qa:cycle                      contra la base local de siempre
 *   QA_API=http://127.0.0.1:55321 QA_DB=supabase_db_budi-cleantest pnpm qa:cycle
 *
 * Recorre los flujos reales por la API (PostgREST + RPC), cada rol con SU
 * token: Usuario particular, afiliado de aseguradora, zona MOPT, pipa, socio
 * de empresa, socio independiente, flota MOPT, admin, soporte, portal MOPT y
 * portal de aseguradora. Verifica dinero (libro), km, SLA, cobertura, quién
 * paga, aislamiento entre clientes y las reglas de cancelación.
 *
 * Crea sus propias cuentas (qa.*@budi.test) y datos: está pensada para una base
 * de prueba. Es idempotente: si las cuentas ya existen, las reutiliza.
 */
import { execFileSync } from 'node:child_process';
import { totp } from './lib-totp.mjs';

const API = process.env.QA_API ?? 'http://127.0.0.1:54321';
// Con varias bases locales corriendo, la de este proyecto (o la de QA_DB).
const DB =
  process.env.QA_DB ??
  (() => {
    const running = execFileSync('docker', ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'])
      .toString()
      .trim()
      .split(/\r?\n/);
    const own = `supabase_db_${process.cwd().split(/[\\/]/).pop()}`;
    return running.find((n) => n === own) ?? running[0];
  })();

// ------------------------------------------------------------------ helpers
const status = JSON.parse(
  execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
    shell: true,
    cwd: process.env.QA_SUPABASE_DIR ?? process.cwd(),
  }).toString().replace(/^[^{]*/, '')
);
const ANON = status.ANON_KEY;
const SERVICE = status.SERVICE_ROLE_KEY;
if (!API.includes(new URL(status.API_URL).port)) {
  console.error(`QA_API (${API}) no coincide con el proyecto de ${process.cwd()} (${status.API_URL}). Usa QA_SUPABASE_DIR.`);
  process.exit(1);
}

let pass = 0;
const fails = [];
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(`${name} ${detail}`);
    console.log(`  ✗ ${name} ${detail}`);
  }
}
const section = (t) => console.log(`\n## ${t}`);

function sql(q) {
  return execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-q'], { input: q })
    .toString()
    .trim();
}
const sqlJson = (q) => JSON.parse(sql(q) || 'null');

async function http(path, { token, method = 'GET', body, key = ANON, prefer = 'return=representation' } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: r.ok, status: r.status, data };
}
const rpc = (fn, args, token) => http(`/rest/v1/rpc/${fn}`, { token, method: 'POST', body: args ?? {} });
const rest = (path, token, opts = {}) => http(`/rest/v1/${path}`, { token, ...opts });

async function ensureUser(email, meta = {}) {
  const created = await http('/auth/v1/admin/users', {
    method: 'POST',
    key: SERVICE,
    body: { email, password: 'Qa123!budi', email_confirm: true, user_metadata: { full_name: meta.full_name ?? email.split('@')[0], ...meta } },
  });
  if (!created.ok && !/already|registered|exists/i.test(JSON.stringify(created.data))) {
    throw new Error(`No se pudo crear ${email}: ${JSON.stringify(created.data)}`);
  }
  return sql(`select id from profiles where email = '${email}'`);
}
async function login(email) {
  const r = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: 'Qa123!budi' } });
  if (!r.ok) throw new Error(`login ${email}: ${JSON.stringify(r.data)}`);
  return r.data.access_token;
}

// Sesión con 2FA (aal2), como la del dueño o un administrador de un portal
// (00113). Descarta los factores previos (su secreto no se conoce) y vincula
// uno nuevo con el código TOTP calculado.
async function loginMfa(email, userId) {
  const token = await login(email);
  const u = await http('/auth/v1/user', { token });
  for (const f of u.data?.factors ?? []) {
    await http(`/auth/v1/admin/users/${userId}/factors/${f.id}`, { method: 'DELETE', key: SERVICE });
  }
  const enr = await http('/auth/v1/factors', { token, method: 'POST', body: { factor_type: 'totp', friendly_name: `qa-${Date.now()}` } });
  const ch = await http(`/auth/v1/factors/${enr.data.id}/challenge`, { token, method: 'POST', body: {} });
  const ver = await http(`/auth/v1/factors/${enr.data.id}/verify`, {
    token,
    method: 'POST',
    body: { challenge_id: ch.data.id, code: totp(enr.data.totp.secret) },
  });
  if (!ver.ok) throw new Error(`2FA ${email}: ${JSON.stringify(ver.data)}`);
  return ver.data.access_token;
}

// Puntos: San Salvador (particular) y la zona MOPT de prueba (Acajutla, Sonsonate).
// Lejos de la zona demo del MOPT (Carretera al Puerto): encimadas, en una base
// local con la demo ganaba el programa más antiguo y el ciclo fallaba.
const SS = { lat: 13.6929, lng: -89.2182 };
const SS_DEST = { lat: 13.7035, lng: -89.2244 };
const ZONA = { lat: 13.58, lng: -89.83 };
const ZONA_DEST = { lat: 13.60, lng: -89.84 };

async function crearSolicitud(token, { at, dest, service = 'tow', plate = 'P111111' }) {
  const r = await rpc(
    'create_service_request',
    {
      p_pickup_address: 'Punto de prueba',
      p_pickup_lat: at.lat,
      p_pickup_lng: at.lng,
      // Como la app: sin destino, el destino es el mismo punto de recogida.
      p_dropoff_address: dest ? 'Destino de prueba' : 'Punto de prueba',
      p_dropoff_lat: (dest ?? at).lat,
      p_dropoff_lng: (dest ?? at).lng,
      p_incident_type: service === 'tow' ? 'Vehículo varado' : 'Necesito agua potable',
      p_service_type: service,
      p_tow_type: 'light',
      p_vehicle_plate: plate,
    },
    token
  );
  return r;
}

// Ciclo del socio: aceptar -> en camino -> PIN -> completar (con recorrido GPS).
async function cicloSocio(tokenOp, opId, reqId, pin, km = 5) {
  const acc = await rpc('accept_service_request', { p_request_id: reqId }, tokenOp);
  // Como la app: update sin pedir la fila de vuelta (el hash del PIN no es legible).
  const enr = await rest(`service_requests?id=eq.${reqId}`, tokenOp, { method: 'PATCH', body: { status: 'en_route' }, prefer: 'return=minimal' });
  // Recorrido sintético: aproximación y arrastre en línea recta (0.01° ≈ 1.11 km).
  sql(`
    insert into service_location_trail (request_id, lat, lng, recorded_at)
    select '${reqId}', 13.60 + i * 0.001, -89.25, now() - interval '30 minutes' + i * interval '20 seconds'
      from generate_series(0, 20) i;
    update service_requests set assigned_at = now() - interval '31 minutes' where id = '${reqId}';
  `);
  const pinR = await rpc('verify_request_pin', { p_request_id: reqId, p_pin: pin }, tokenOp);
  // Arrastre: entre la llegada (corrida 10 min atrás) y ahora, antes del cierre.
  sql(`
    update service_requests set activated_at = now() - interval '10 minutes' where id = '${reqId}';
    insert into service_location_trail (request_id, lat, lng, recorded_at)
    select '${reqId}', 13.62 + i * 0.001, -89.25, now() - interval '9 minutes' + i * interval '20 seconds'
      from generate_series(0, 20) i;
  `);
  const comp = await rpc('complete_service_request', { p_request_id: reqId, p_distance_pickup_to_dropoff: km }, tokenOp);
  return { acc, enr, pinR, comp };
}

// ------------------------------------------------------------------ escena
section('Preparación');
const ids = {};
for (const [k, email, meta] of [
  ['admin', 'qa.admin@budi.test', {}],
  ['soporte', 'qa.soporte@budi.test', {}],
  ['particular', 'qa.particular@budi.test', {}],
  ['afiliado', 'qa.afiliado@budi.test', {}],
  ['op', 'qa.op@budi.test', { role: 'OPERATOR' }],
  ['opInd', 'qa.op.ind@budi.test', { role: 'OPERATOR' }],
  ['opMopt', 'qa.op.mopt@budi.test', { role: 'OPERATOR' }],
  ['opPipa', 'qa.op.pipa@budi.test', { role: 'OPERATOR' }],
  ['mopt', 'qa.mopt@budi.test', {}],
  ['aseg', 'qa.aseg@budi.test', {}],
]) {
  ids[k] = await ensureUser(email, meta);
}

// 00153: el interruptor de aseguradoras viene apagado y el ciclo las ejercita.
// Se prende para la corrida y se deja como estaba al salir (pase lo que pase).
const aseguradorasAntes = sql(`select insurers_enabled from platform_features where id = 1`);
sql(`update platform_features set insurers_enabled = true where id = 1`);
process.on('exit', () => {
  try {
    sql(`update platform_features set insurers_enabled = ${aseguradorasAntes === 't' ? 'true' : 'false'} where id = 1`);
  } catch {
    console.error('No se pudo restaurar el interruptor de aseguradoras; revisa platform_features.');
  }
});

// Roles, empresas, verificación, afiliación, programa MOPT, zona, unidades y ubicaciones.
const setup = sqlJson(`
  do $$ begin
    update profiles set role = 'ADMIN' where id = '${ids.admin}';
    update profiles set role = 'SUPPORT' where id = '${ids.soporte}';
    update profiles set provider_id = '11111111-1111-1111-1111-111111111111', verification_status = 'approved' where id = '${ids.op}';
    update profiles set provider_id = null, verification_status = 'approved' where id = '${ids.opInd}';
    update profiles set provider_id = '22222222-2222-2222-2222-222222222222', verification_status = 'approved' where id = '${ids.opPipa}';
    insert into profile_sensitive (profile_id, dui_number) values ('${ids.afiliado}', '01234567-8')
      on conflict (profile_id) do update set dui_number = excluded.dui_number;
    if not exists (select 1 from providers where name = 'QA MOPT') then
      insert into providers (name, is_mopt, is_active, business_type) values ('QA MOPT', true, true, 'roadside');
    end if;
  end $$;
  with prog as (select id from providers where name = 'QA MOPT')
  update profiles set provider_id = (select id from prog), verification_status = 'approved' where id = '${ids.opMopt}';
  insert into mopt_zones (provider_id, name, polygon, service_types, is_active)
  select id, 'Zona QA', '[[13.54,-89.87],[13.54,-89.79],[13.64,-89.79],[13.64,-89.87]]'::jsonb, array['tow'], true
    from providers p where name = 'QA MOPT' and not exists (select 1 from mopt_zones z where z.provider_id = p.id);
  -- Bases que ya tenían la Zona QA vieja (encima de la demo): la mueve.
  update mopt_zones z set polygon = '[[13.54,-89.87],[13.54,-89.79],[13.64,-89.79],[13.64,-89.87]]'::jsonb
    from providers p where p.id = z.provider_id and p.name = 'QA MOPT' and z.name = 'Zona QA';
  insert into organization_members (organization_id, profile_id, role)
  select o.id, '${ids.mopt}', 'owner' from organizations o join providers p on p.id = o.provider_id where p.name = 'QA MOPT'
  on conflict do nothing;
  insert into organization_members (organization_id, profile_id, role)
  select o.id, '${ids.aseg}', 'owner' from organizations o where o.insurer_id = 'a0000000-0000-0000-0000-000000000001'
  on conflict do nothing;
  insert into provider_services (provider_id, service_id, is_available)
  select pr.id, s.id, true from providers pr, services s
   where (pr.id = '11111111-1111-1111-1111-111111111111' and s.slug = 'tow')
      or (pr.id = '22222222-2222-2222-2222-222222222222' and s.slug = 'water_truck')
      or (pr.name = 'QA MOPT' and s.slug = 'tow')
  on conflict do nothing;
  insert into operator_vehicles (operator_id, plate, vehicle_type, capacity_m3)
  select * from (values ('${ids.op}'::uuid, 'QA0001', 'tow_light', null::numeric),
                        ('${ids.opMopt}'::uuid, 'QAMOPT1', 'tow_light', null),
                        ('${ids.opPipa}'::uuid, 'QAPIPA1', 'water_truck', 10)) v(o, p, t, c)
   where not exists (select 1 from operator_vehicles x where x.operator_id = v.o and x.is_active);
  insert into operator_locations (operator_id, lat, lng, is_online, updated_at)
  select o, lat, lng, true, now() from (values ('${ids.op}'::uuid, 13.69, -89.21), ('${ids.opInd}'::uuid, 13.69, -89.21),
                                               ('${ids.opMopt}'::uuid, 13.58, -89.82), ('${ids.opPipa}'::uuid, 13.69, -89.21)) v(o, lat, lng)
  on conflict (operator_id) do update set is_online = true, updated_at = now(), lat = excluded.lat, lng = excluded.lng;
  -- Solicitudes abiertas de corridas anteriores: se cierran para empezar limpio.
  update service_requests set status = 'cancelled', cancelled_at = now()
   where status in ('initiated','assigned','en_route','active')
     and user_id in ('${ids.particular}', '${ids.afiliado}');
  select json_build_object('ok', true);
`);
check('escena preparada (10 cuentas, programa MOPT, zona, unidades)', setup?.ok === true);

const T = {};
for (const k of Object.keys(ids)) T[k] = await login(`qa.${k === 'opInd' ? 'op.ind' : k === 'opMopt' ? 'op.mopt' : k === 'opPipa' ? 'op.pipa' : k}@budi.test`);
// Dueños de portal: sin 2FA no ven nada (00113). Se guarda también la sesión sin 2FA.
const T1 = { mopt: T.mopt, aseg: T.aseg };
T.mopt = await loginMfa('qa.mopt@budi.test', ids.mopt);
T.aseg = await loginMfa('qa.aseg@budi.test', ids.aseg);

// ------------------------------------------------------------------ 1. registro
section('1. Registro no permite elegir un rol privilegiado');
{
  const email = `qa.intruso.${Date.now()}@budi.test`;
  const r = await http('/auth/v1/signup', { method: 'POST', body: { email, password: 'Qa123!budi', data: { role: 'ADMIN' } } });
  const role = sql(`select role from profiles where email = '${email}'`);
  check('signup con role=ADMIN en metadata queda como USER', r.ok && role === 'USER', `(rol: ${role})`);
}

// ------------------------------------------------------------------ 2. particular
section('2. Servicio particular (grúa, San Salvador, socio de empresa)');
let reqPart;
{
  const prev = await rpc('preview_mopt_services', { p_lat: SS.lat, p_lng: SS.lng }, T.particular);
  check('fuera de zona MOPT: nada "Sin costo"', Array.isArray(prev.data) && prev.data.length === 0, JSON.stringify(prev.data));
  const c = await crearSolicitud(T.particular, { at: SS, dest: SS_DEST });
  check('Usuario crea la solicitud', c.ok && c.data?.success !== false && c.data?.request_id, JSON.stringify(c.data).slice(0, 200));
  reqPart = c.data?.request_id;
  const pin = c.data?.pin;
  check('recibe su PIN de confirmación (4 dígitos)', /^\d{4}$/.test(pin ?? ''));
  check('no es MOPT', c.data?.mopt == null);

  const poolOp = await rpc('get_available_requests_for_operator', {}, T.op);
  check('el socio de la empresa la ve en su pool', JSON.stringify(poolOp.data).includes(reqPart), `(${poolOp.status})`);
  const poolMopt = await rpc('get_available_requests_for_operator', {}, T.opMopt);
  check('la flota MOPT NO la ve (flota cerrada)', !JSON.stringify(poolMopt.data ?? '').includes(reqPart));
  const payer = await rpc('service_payer_info', { p_request_ids: [reqPart] }, T.op);
  check('quién paga para el socio: el Usuario', payer.data?.[0]?.payer === 'user', JSON.stringify(payer.data));

  const hashLeak = await rest(`service_requests?id=eq.${reqPart}&select=pin_hash`, T.op);
  check('el socio no puede leer el hash del PIN', !hashLeak.ok || !JSON.stringify(hashLeak.data).includes('$2'), `(${hashLeak.status})`);
  const wrongPin = await rpc('verify_request_pin', { p_request_id: reqPart, p_pin: '0000' === pin ? '1111' : '0000' }, T.op);
  check('PIN equivocado sin aceptar: rechazado', wrongPin.data?.valid !== true);

  const { acc, enr, pinR, comp } = await cicloSocio(T.op, ids.op, reqPart, pin, 5);
  check('acepta', acc.ok && acc.data?.success !== false, JSON.stringify(acc.data).slice(0, 150));
  check('marca en camino', enr.ok, JSON.stringify(enr.data).slice(0, 150));
  check('PIN de confirmación correcto activa el servicio', pinR.data?.valid === true, JSON.stringify(pinR.data));
  check('completa con precio', comp.ok && comp.data?.success !== false, JSON.stringify(comp.data).slice(0, 150));

  const fila = sqlJson(`select json_build_object('status', sr.status, 'total', sr.total_price, 'approach', c.approach_km, 'tow', c.tow_km, 'plate', c.vehicle_plate)
                          from service_requests sr join cases c on c.request_id = sr.id where sr.id = '${reqPart}'`);
  check('queda completado con total > 0', fila.status === 'completed' && Number(fila.total) > 0, JSON.stringify(fila));
  check('km GPS de aproximación (~2.2 km) y arrastre (~2.2 km)', Math.abs(fila.approach - 2.22) < 0.2 && Math.abs(fila.tow - 2.22) < 0.2, JSON.stringify(fila));
  check('el caso registra la placa de la grúa', fila.plate === 'QA0001');

  const libro = sqlJson(`select json_agg(json_build_object('c', concept, 'd', debtor_kind, 'cr', creditor_kind, 'a', amount)) from ledger_obligations() where request_id = '${reqPart}'`);
  const total = Number(fila.total);
  const pago = libro?.find((x) => x.c === 'servicio');
  check('libro: Budi le debe a la empresa el bruto menos 20 %', pago && pago.cr === 'provider' && Math.abs(Number(pago.a) - (total - Math.round(total * 20) / 100)) < 0.011, JSON.stringify(libro));

  const rate = await rpc('rate_service', { p_request_id: reqPart, p_stars: 5, p_comment: 'Excelente' }, T.particular);
  check('el Usuario califica', rate.ok && rate.data?.success !== false, JSON.stringify(rate.data).slice(0, 120));
  const earn = await rpc('my_operator_earnings', { p_from: '2020-01-01', p_to: '2030-12-31' }, T.op);
  check('el socio ve su neto (con comisión, no el bruto)', Number(earn.data?.[0]?.a_pagar) < Number(earn.data?.[0]?.bruto), JSON.stringify(earn.data));
}

// ------------------------------------------------------------------ 3. MOPT
section('3. Cortesía MOPT (zona, flota cerrada, portal, km por grúa)');
let reqMopt;
{
  const prev = await rpc('preview_mopt_services', { p_lat: ZONA.lat, p_lng: ZONA.lng }, T.particular);
  check('en la zona, grúa sale "Sin costo"', Array.isArray(prev.data) && prev.data.includes('tow'), JSON.stringify(prev.data));
  const c = await crearSolicitud(T.particular, { at: ZONA, dest: ZONA_DEST });
  reqMopt = c.data?.request_id;
  check('la solicitud queda cargada al MOPT', c.ok && c.data?.mopt != null, JSON.stringify(c.data?.mopt));
  const poolOp = await rpc('get_available_requests_for_operator', {}, T.op);
  check('un socio privado NO la ve', !JSON.stringify(poolOp.data ?? '').includes(reqMopt));
  const poolMopt = await rpc('get_available_requests_for_operator', {}, T.opMopt);
  check('la flota MOPT sí la ve', JSON.stringify(poolMopt.data ?? '').includes(reqMopt));
  const payer = await rpc('service_payer_info', { p_request_ids: [reqMopt] }, T.opMopt);
  check('el socio ve "Cortesía MOPT" antes de aceptar', payer.data?.[0]?.label === 'Cortesía MOPT', JSON.stringify(payer.data));
  const r = await cicloSocio(T.opMopt, ids.opMopt, reqMopt, c.data?.pin, 3);
  check('la flota MOPT completa el ciclo', r.comp.ok && r.comp.data?.success !== false, JSON.stringify(r.comp.data).slice(0, 150));

  const libro = sqlJson(`select json_agg(json_build_object('c', concept, 'd', debtor_kind, 'cr', creditor_kind, 'a', amount)) from ledger_obligations() where request_id = '${reqMopt}'`);
  const total = Number(sql(`select total_price from service_requests where id = '${reqMopt}'`));
  check('libro: el MOPT le debe el bruto a su socio', libro?.some((x) => x.d === 'mopt' && x.cr === 'operator' && Number(x.a) === total), JSON.stringify(libro));
  check('libro: el Usuario no debe nada', !libro?.some((x) => x.d === 'user'));

  const hoy = sql(`select sv_today()`);
  const comp = await rpc('mopt_compliance', { p_from: '2020-01-01', p_to: hoy }, T.mopt);
  check('portal MOPT: el tablero cuenta el caso', Number(comp.data?.completed) >= 1, JSON.stringify(comp.data).slice(0, 200));
  const km = await rpc('mopt_km_by_vehicle', { p_from: '2020-01-01', p_to: hoy }, T.mopt);
  check('portal MOPT: km por grúa con la placa QAMOPT1', km.data?.some?.((x) => x.plate === 'QAMOPT1' && Number(x.total_km) > 4), JSON.stringify(km.data).slice(0, 200));
  const ajeno = await rest(`service_requests?id=eq.${reqPart}&select=id`, T.mopt);
  check('portal MOPT: no ve servicios particulares', Array.isArray(ajeno.data) && ajeno.data.length === 0);
}

// ------------------------------------------------------------------ 4. aseguradora
section('4. Afiliado de aseguradora (cobertura, portal, aislamiento)');
let reqAseg;
{
  const cov = await rpc('check_member_coverage', {}, T.afiliado);
  check('el afiliado tiene cobertura vigente', cov.data?.status === 'covered', JSON.stringify(cov.data).slice(0, 150));
  const c = await crearSolicitud(T.afiliado, { at: SS, dest: SS_DEST, plate: 'P222222' });
  reqAseg = c.data?.request_id;
  check('la solicitud queda cubierta', c.ok && c.data?.coverage?.status === 'covered', JSON.stringify(c.data?.coverage).slice(0, 150));
  const payer = await rpc('service_payer_info', { p_request_ids: [reqAseg] }, T.op);
  check('el socio ve "Cubierto por Seguros Demo"', /Cubierto por Seguros Demo/.test(payer.data?.[0]?.label ?? ''), JSON.stringify(payer.data));
  const r = await cicloSocio(T.op, ids.op, reqAseg, c.data?.pin, 4);
  check('ciclo completo', r.comp.ok && r.comp.data?.success !== false, JSON.stringify(r.comp.data).slice(0, 150));
  const libro = sqlJson(`select json_agg(json_build_object('c', concept, 'd', debtor_kind, 'a', amount)) from ledger_obligations() where request_id = '${reqAseg}'`);
  check('libro: la aseguradora le debe a Budi la cobertura', libro?.some((x) => x.c === 'cobertura' && x.d === 'insurer' && Number(x.a) > 0), JSON.stringify(libro));

  const casos = await rest(`service_requests?select=id`, T.aseg);
  const vistos = JSON.stringify(casos.data ?? '');
  check('portal aseguradora: ve el caso cubierto', vistos.includes(reqAseg));
  check('portal aseguradora: NO ve el particular ni el MOPT', !vistos.includes(reqPart) && !vistos.includes(reqMopt));
  const folio = sql(`select folio from cases where request_id = '${reqAseg}'`);
  const tl = await rpc('get_case_timeline', { p_folio: folio }, T.aseg);
  check('portal aseguradora: línea de tiempo con textos en tuteo/terminología', JSON.stringify(tl.data).includes('Socio operador asignado'), JSON.stringify(tl.data).slice(0, 200));
}

// ------------------------------------------------------------------ 5. pipa
section('5. Pipa de agua (viaje + km, sin destino)');
{
  const c = await crearSolicitud(T.particular, { at: SS, service: 'water_truck' });
  const reqPipa = c.data?.request_id;
  check('se puede pedir una pipa', c.ok && !!reqPipa, JSON.stringify(c.data).slice(0, 150));
  const poolOp = await rpc('get_available_requests_for_operator', {}, T.op);
  check('un socio sin el servicio NO la ve', !JSON.stringify(poolOp.data ?? '').includes(reqPipa));
  const poolPipa = await rpc('get_available_requests_for_operator', {}, T.opPipa);
  check('el socio con pipa sí la ve', JSON.stringify(poolPipa.data ?? '').includes(reqPipa));
  sql(`update service_requests set distance_operator_to_pickup_km = 6 where id = '${reqPipa}'`);
  const r = await cicloSocio(T.opPipa, ids.opPipa, reqPipa, c.data?.pin, 0);
  const total = Number(sql(`select total_price from service_requests where id = '${reqPipa}'`));
  check('precio = $40 base + 6 km × $1.50 = $49.00', r.comp.ok && total === 49, `(total ${total})`);
}

// ------------------------------------------------------------------ 6. cancelaciones
section('6. Reglas de cancelación');
{
  const c = await crearSolicitud(T.particular, { at: SS, dest: SS_DEST });
  const id = c.data?.request_id;
  const anon = await rpc('cancel_service_request', { p_request_id: id, p_reason: 'x' }, ANON);
  check('sin sesión no cancela', anon.data?.success !== true);
  const anonAdm = await rpc('admin_cancel_request', { p_request_id: id, p_reason: 'x' }, ANON);
  check('sin sesión no fuerza cancelación', !anonAdm.ok);
  const aseg = await rpc('cancel_service_request', { p_request_id: id, p_reason: 'x' }, T.aseg);
  check('una cuenta de aseguradora no cancela servicios ajenos', aseg.data?.success !== true);
  const otro = await rpc('cancel_service_request', { p_request_id: id, p_reason: 'x' }, T.afiliado);
  check('otro Usuario no cancela', otro.data?.success !== true);
  const sop = await rpc('admin_cancel_request', { p_request_id: reqPart, p_reason: 'x' }, T.soporte);
  check('soporte no puede cancelar un servicio completado', !sop.ok);
  const own = await rpc('cancel_service_request', { p_request_id: id, p_reason: 'Ya no lo necesito' }, T.particular);
  check('el dueño cancela el suyo', own.data?.success === true, JSON.stringify(own.data));
  const ev = sql(`select event_type from request_events where request_id = '${id}' order by created_at desc limit 1`);
  check('evento USER_CANCELLED', ev === 'USER_CANCELLED', ev);
  const inject = await rpc('create_request_event', { p_request_id: reqAseg, p_event_type: 'ADMIN_CANCELLED', p_payload: {} }, T.particular);
  check('nadie inyecta eventos en la línea de tiempo', !inject.ok);
}

// ------------------------------------------------------------------ 7. soporte y admin
section('7. Soporte y admin');
{
  const c = await crearSolicitud(T.particular, { at: SS, dest: SS_DEST });
  const id = c.data?.request_id;
  const sug = await rpc('suggest_nearest_operators', { p_request_id: id, p_limit: 3 }, T.soporte);
  check('soporte ve sugerencias del más cercano', sug.ok, JSON.stringify(sug.data).slice(0, 120));
  const asig = await rpc('admin_assign_request', { p_request_id: id, p_operator_id: ids.op }, T.soporte);
  check('soporte asigna', asig.ok, JSON.stringify(asig.data).slice(0, 150));
  const canc = await rpc('admin_cancel_request', { p_request_id: id, p_reason: 'Prueba de soporte' }, T.soporte);
  check('soporte cancela un servicio abierto', canc.ok, JSON.stringify(canc.data).slice(0, 150));
  const ev = sql(`select event_type from request_events where request_id = '${id}' order by created_at desc limit 1`);
  check('queda como ADMIN_CANCELLED ("Cancelado por Budi")', ev === 'ADMIN_CANCELLED', ev);
  const fin = await rpc('admin_finance_summary', { p_from: '2020-01-01', p_to: '2030-12-31' }, T.soporte);
  check('soporte NO ve finanzas', !fin.ok);
  const neg = await rpc('admin_business_dashboard', {}, T.admin);
  check('admin: dashboard de negocio', neg.ok && Array.isArray(neg.data?.months));
  const ficha = await rpc('admin_account_360', { p_kind: 'mopt', p_id: sql(`select id from providers where name = 'QA MOPT'`), p_from: '2020-01-01', p_to: '2030-12-31' }, T.admin);
  check('admin: ficha 360 del MOPT con saldo en el libro', ficha.ok && ficha.data?.balances?.length > 0, JSON.stringify(ficha.data?.money).slice(0, 150));
}

// ------------------------------------------------------------------ 8. tarifas versionadas
section('8. Tarifas versionadas');
{
  const antes = sql(`select sum(amount) from ledger_obligations() where creditor_id = '11111111-1111-1111-1111-111111111111'`);
  const r = await rpc('admin_set_provider_commission', { p_provider_id: '11111111-1111-1111-1111-111111111111', p_rate: 15 }, T.admin);
  const despues = sql(`select sum(amount) from ledger_obligations() where creditor_id = '11111111-1111-1111-1111-111111111111'`);
  check('cambiar la comisión hoy no reescribe lo ya completado', r.ok && antes === despues, `${antes} -> ${despues}`);
  const atras = await rpc('admin_schedule_rate', { p_kind: 'provider', p_subject: '11111111-1111-1111-1111-111111111111', p_rate: 10, p_effective: '2020-01-01' }, T.admin);
  check('no se puede fijar una tarifa hacia atrás', !atras.ok);
  await rpc('admin_set_provider_commission', { p_provider_id: '11111111-1111-1111-1111-111111111111', p_rate: 20 }, T.admin);
}

// ------------------------------------------------------------------ 9. retención
section('9. Retención de datos (Decreto 144)');
{
  // Todo en una sesión y revertido: la prueba no borra datos de verdad.
  const [purga, quedan, km] = sql(`begin;
    update service_requests set completed_at = now() - interval '100 days' where id = '${reqPart}';
    select purge_expired_personal_data();
    select count(*) from service_location_trail where request_id = '${reqPart}';
    select approach_km from cases where request_id = '${reqPart}';
    rollback;`).split(/\r?\n/);
  const r = JSON.parse(purga);
  check('el recorrido de más de 90 días se borra', r?.trail_points > 0 && quedan === '0', purga);
  check('y el caso conserva sus km', Number(km) > 0, km);
}

// ------------------------------------------------------------------ 10. POR-02
section('10. Equipo del portal: 2FA, invitación, roles y bitácora (POR-02)');
{
  const sin2fa = await rest('service_requests?select=id', T1.aseg);
  check('el dueño sin 2FA no ve casos', Array.isArray(sin2fa.data) && sin2fa.data.length === 0);
  const org = await rpc('my_organization', {}, T1.aseg);
  check('la web sabe que le falta el 2FA', org.data?.mfa_required === true && org.data?.mfa_ok === false, JSON.stringify(org.data));

  const email = `qa.equipo.${Date.now()}@budi.test`;
  const inv = await rpc('org_invite', { p_email: email, p_role: 'analyst' }, T.aseg);
  check('el dueño (con 2FA) invita', inv.ok && /^[0-9a-f]{48}$/.test(inv.data?.token ?? ''), JSON.stringify(inv.data).slice(0, 120));
  const intruso = await rpc('accept_org_invitation', { p_token: inv.data?.token }, T.particular);
  check('otra cuenta no puede usar la invitación', !intruso.ok);
  const nuevoId = await ensureUser(email);
  const tNuevo = await login(email);
  const acc = await rpc('accept_org_invitation', { p_token: inv.data?.token }, tNuevo);
  check('la persona invitada acepta', acc.ok && acc.data?.role === 'analyst', JSON.stringify(acc.data));
  const ve = await rest('service_requests?select=id', tNuevo);
  check('la analista ve los casos de su aseguradora (sin necesitar 2FA)', Array.isArray(ve.data) && ve.data.length > 0);
  const noInvita = await rpc('org_invite', { p_email: 'x@budi.test', p_role: 'viewer' }, tNuevo);
  check('una analista no invita', !noInvita.ok);
  const baja = await rpc('org_update_member', { p_profile_id: nuevoId, p_status: 'disabled' }, T.aseg);
  const yaNo = await rest('service_requests?select=id', tNuevo);
  check('al quitarle el acceso deja de ver casos al instante', baja.ok && Array.isArray(yaNo.data) && yaNo.data.length === 0);
  const auto = await rpc('org_update_member', { p_profile_id: ids.aseg, p_role: 'viewer' }, T.aseg);
  check('el dueño no puede cambiarse a sí mismo', !auto.ok);
  const log = await rpc('org_access_log', { p_limit: 50 }, T.aseg);
  check('la bitácora muestra la invitación y la baja', JSON.stringify(log.data).includes('Invitó a') && JSON.stringify(log.data).includes('Quitó el acceso'), JSON.stringify(log.data).slice(0, 160));
  const logAnalista = await rpc('org_access_log', { p_limit: 5 }, tNuevo);
  check('solo quien administra ve la bitácora', !logAnalista.ok);
}

// ------------------------------------------------------------------ resumen
console.log(`\n========== ${pass}/${pass + fails.length} verde ==========`);
if (fails.length) {
  console.log('FALLAS:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
