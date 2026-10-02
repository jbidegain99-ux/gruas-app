#!/usr/bin/env node
// =====================================================================
// Entorno de DEMO: una Supabase local aparte, siempre limpia
//
//   node scripts/demo-env.mjs up        levanta la base de demo (la arma si no existe)
//   node scripts/demo-env.mjs fresh     la borra, aplica todas las migraciones y siembra la demo
//   node scripts/demo-env.mjs down      la apaga
//   node scripts/demo-env.mjs status    dice si está arriba y dónde
//
// Por qué aparte: la base local de desarrollo junta miles de casos de pruebas
// (qa-cycle, recorridos, datos a medio armar). Para mostrarle Budi a un
// cliente, el admin, el portal y la app tienen que verse como el primer día de
// una operación real: solo la demo. Esta base vive en .demo/ (fuera de git),
// con su propio proyecto de Supabase en otros puertos, así que convive con la
// de desarrollo sin tocarla.
//
// Las apps se apuntan a ella pisando la URL al arrancar (dev.ps1 -Demo): las
// claves locales de Supabase son las mismas en los dos proyectos.
// =====================================================================
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(RAIZ, '.demo');
const PROYECTO = 'budi-demo';
// 583xx: fuera de los rangos que Windows suele reservar (Hyper-V toma bloques
// en 543xx-555xx; ahí chocaba la base de pruebas limpia).
const PUERTO_BASE = 58320;
export const DEMO_API = `http://127.0.0.1:${PUERTO_BASE + 1}`;
const DB = `supabase_db_${PROYECTO}`;
// Lo pesado que la demo no usa. Las Edge Functions se sirven aparte
// (dev.ps1 -Demo abre `supabase functions serve --workdir .demo`).
const SIN = 'studio,imgproxy,vector,logflare,supavisor,edge-runtime';

const sb = (args, opts = {}) =>
  spawnSync('npx', ['supabase', ...args, '--workdir', '.demo'], { cwd: RAIZ, stdio: 'inherit', shell: true, ...opts });

// Copia el proyecto de Supabase del repo con otro nombre y otros puertos.
// Se rehace cada vez: si entró una migración nueva, la demo la toma.
function preparar() {
  const dst = join(DIR, 'supabase');
  mkdirSync(dst, { recursive: true });
  for (const d of ['migrations', 'functions']) {
    rmSync(join(dst, d), { recursive: true, force: true });
    cpSync(join(RAIZ, 'supabase', d), join(dst, d), { recursive: true });
  }
  cpSync(join(RAIZ, 'supabase', 'seed.sql'), join(dst, 'seed.sql'));
  let cfg = readFileSync(join(RAIZ, 'supabase', 'config.toml'), 'utf8');
  // Sin project_id, la CLI nombra el proyecto por la carpeta ("demo"); con él,
  // los contenedores quedan como supabase_*_budi-demo.
  cfg = /^project_id\s*=/m.test(cfg)
    ? cfg.replace(/^project_id\s*=.*$/m, `project_id = "${PROYECTO}"`)
    : `project_id = "${PROYECTO}"
${cfg}`;
  // 54320-54329 (los puertos del proyecto de desarrollo) -> 58320-58329.
  cfg = cfg.replace(/(port\s*=\s*)543(2\d)\b/g, (_, k, n) => `${k}583${n}`);
  writeFileSync(join(dst, 'config.toml'), cfg);
  if (!existsSync(join(DIR, '.gitignore'))) writeFileSync(join(DIR, '.gitignore'), '*\n');
}

const arriba = () => {
  try {
    return execFileSync('docker', ['ps', '--filter', `name=${DB}`, '--format', '{{.Names}}']).toString().trim() === DB;
  } catch {
    return false;
  }
};

function up() {
  preparar();
  if (!arriba()) {
    console.log('\n· levantando la base de demo (la primera vez tarda un par de minutos)');
    const r = sb(['start', '-x', SIN]);
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  console.log(`\n  Base de demo arriba en ${DEMO_API}`);
}

function fresh() {
  up();
  console.log('\n· borrando la base de demo y aplicando todas las migraciones');
  const r = sb(['db', 'reset']);
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log('\n· sembrando la demo');
  const s = spawnSync(process.execPath, [join(RAIZ, 'scripts', 'demo.mjs'), 'seed'], {
    cwd: RAIZ, stdio: 'inherit', env: { ...process.env, DEMO_SUPABASE_URL: DEMO_API },
  });
  if (s.status !== 0) process.exit(s.status ?? 1);

  // La cola de push se vacía llamando a la Edge Function desde la base: sin
  // estos dos secretos, cada notificación de la demo quedaba "atascada" y el
  // panel del admin lo marcaba en rojo. Con un teléfono registrado (Expo Go),
  // la push llega de verdad.
  const service = readFileSync(join(RAIZ, 'apps/web/.env.local'), 'utf8').match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();
  if (service) {
    execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], {
      input: `select vault.create_secret('http://supabase_kong_${PROYECTO}:8000/functions/v1', 'edge_functions_url');
              select vault.create_secret('${service}', 'service_role_key');`,
    });
  }
  console.log('\n  Demo lista. Levanta las apps con:  .\\dev.ps1 -Demo\n');
}

function down() {
  if (!arriba()) return console.log('\n  La base de demo ya estaba apagada.\n');
  sb(['stop']);
}

function status() {
  console.log(arriba() ? `\n  Base de demo arriba en ${DEMO_API}\n` : '\n  Base de demo apagada.  ->  pnpm demo:up\n');
}

const cmd = process.argv[2] || 'status';
const acciones = { up, fresh, down, status };
if (!acciones[cmd]) {
  console.error('\n  uso: node scripts/demo-env.mjs up | fresh | down | status\n');
  process.exit(1);
}
acciones[cmd]();
