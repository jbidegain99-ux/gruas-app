#!/usr/bin/env node
/**
 * Receptor de webhooks de prueba (ASE-04). Hace lo que haría la aseguradora:
 * verifica la firma HMAC, rechaza entregas viejas y deduplica por id.
 *
 *   node scripts/webhook-receiver.mjs --secret whsec_... [--port 4555] [--fail 2]
 *
 * --fail N  responde 500 a las primeras N entregas (para ver los reintentos).
 *
 * Desde la base local (Docker) la URL es http://host.docker.internal:4555/hook
 * y hace falta `ALTER DATABASE postgres SET app.webhooks_allow_local = 'on'`.
 */
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const secret = opt('secret', process.env.BUDI_WEBHOOK_SECRET);
const port = Number(opt('port', 4555));
let failLeft = Number(opt('fail', 0));
if (!secret) {
  console.error('Falta --secret whsec_... (o BUDI_WEBHOOK_SECRET)');
  process.exit(1);
}

const TOLERANCE_S = 300;
const seen = new Set();

/** Verificación de referencia: la misma que va en docs/API_AFILIADOS.md. */
function verify(rawBody, header) {
  const parts = Object.fromEntries(
    String(header ?? '')
      .split(',')
      .map((p) => p.split('=', 2)),
  );
  const t = Number(parts.t);
  if (!t || !parts.v1) return 'sin firma';
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_S) return 'firma vencida';
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parts.v1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? null : 'firma inválida';
}

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const problem = verify(raw, req.headers['x-budi-signature']);
    const id = req.headers['x-budi-delivery'];
    const stamp = new Date().toISOString().slice(11, 19);
    if (problem) {
      console.log(`${stamp} ✗ ${problem} (${req.headers['x-budi-event']})`);
      res.writeHead(401).end();
      return;
    }
    if (failLeft > 0) {
      failLeft--;
      console.log(`${stamp} ↺ 500 forzado a ${req.headers['x-budi-event']} ${id}`);
      res.writeHead(500).end();
      return;
    }
    const body = JSON.parse(raw);
    const dup = seen.has(id);
    seen.add(id);
    console.log(
      `${stamp} ✓ ${body.type} ${body.data?.folio ?? ''} status=${body.data?.status ?? ''}${dup ? ' (repetido)' : ''}`,
    );
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
}).listen(port, () => console.log(`Escuchando webhooks en http://localhost:${port}/hook`));
