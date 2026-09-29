#!/usr/bin/env node
/**
 * Corre los tests SQL de supabase/tests/ contra la base LOCAL (Docker).
 *
 *   pnpm db:test                 todos los *.sql de supabase/tests
 *   pnpm db:test support_role    solo ese
 *
 * Cada test abre su propia transaccion y la revierte: no deja datos. Falla
 * (exit 1) si psql reporta cualquier ERROR, incluidos los ASSERT.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = join(root, 'supabase', 'tests');

// El contenedor se llama supabase_db_<project_id>; sin project_id en
// config.toml, el CLI usa el nombre de la carpeta. Con varias bases locales
// corriendo (p. ej. una limpia de prueba) se elige la de ESTE proyecto, no la
// primera que aparezca. QA_DB fuerza otra.
const running = execFileSync('docker', ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'])
  .toString()
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const container =
  process.env.QA_DB ?? running.find((n) => n === `supabase_db_${basename(root)}`) ?? running[0];
if (!container) {
  console.error('No hay una base Supabase local corriendo (supabase start).');
  process.exit(1);
}

const only = process.argv[2];
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => !only || f.replace(/\.sql$/, '') === only);

let failed = 0;
for (const file of files) {
  const res = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], {
    input: readFileSync(join(testsDir, file)),
  });
  const out = `${res.stdout}${res.stderr}`;
  const lines = out.split('\n').filter((l) => /NOTICE|ERROR|CONTEXT/.test(l));
  const ok = res.status === 0 && !/ERROR/.test(out);
  console.log(`${ok ? '✓' : '✗'} ${file}`);
  for (const l of lines) console.log(`    ${l.replace(/^psql:[^:]+:\d+: /, '')}`);
  if (!ok) failed++;
}

process.exit(failed ? 1 : 0);
