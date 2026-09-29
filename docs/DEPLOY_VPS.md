# Deploy Budi en VPS — Scope A

**Decisión (2026-05-25):** Web Next.js en un VPS con Docker + Caddy.
Supabase sigue en cuenta managed (Budi_app). Móvil sigue distribuyéndose
por Expo/EAS.

**Proveedor:** pendiente (sin afectar el plan — todo es Docker portable).
Hetzner CX22 (~€4/mes) alcanza; CX32 (~€8/mes) si querés holgura.

---

## 1. Arquitectura del deploy

```
                    Usuario
                       │
                       ▼
              ┌──────────────────┐
              │  Caddy (:443)    │  ← Let's Encrypt automático
              │  reverse proxy   │
              └────────┬─────────┘
                       │ HTTP a :3000
                       ▼
              ┌──────────────────┐
              │  budi-web        │  ← container Next.js standalone
              │  (Docker)        │
              └────────┬─────────┘
                       │ HTTPS
                       ▼
              ┌──────────────────┐
              │  Supabase        │  ← managed (Budi_app)
              │  Auth / DB /     │     project-ref: qmjpotnmiusxyfujhdqp
              │  Realtime /      │
              │  Edge Functions  │
              └──────────────────┘
```

Móvil (Expo) habla directo con Supabase managed, sin pasar por el VPS.

---

## 2. Qué hay listo en el repo

| Archivo | Para qué |
|---|---|
| `apps/web/Dockerfile` | Build multi-stage de la imagen web standalone |
| `.dockerignore` | Mantiene el build context tight (~5 MB en lugar de 200+) |
| `docker-compose.dev.yml` | Validar el Dockerfile local contra Supabase managed o `supabase start` |
| `docker-compose.prod.yml` | Stack final del VPS: web + Caddy |
| `deploy/Caddyfile.example` | Template del reverse proxy (un dominio) |
| `.env.production.example` | Template de secretos prod con anotaciones |
| `pnpm db:types` | Genera tipos desde Supabase managed (`--linked`, sin Docker) |

---

## 3. Provisioning del VPS (primera vez)

Asume Ubuntu 24.04 LTS. Ajustá para otra distro.

```bash
# 1. SSH como root, crear usuario sin privilegios
adduser budi
usermod -aG sudo budi
rsync --archive --chown=budi:budi ~/.ssh /home/budi
# Salir y volver a entrar como `budi` en adelante.

# 2. Hardening básico
sudo apt update && sudo apt upgrade -y
sudo apt install -y ufw fail2ban unattended-upgrades
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
sudo systemctl enable --now fail2ban
sudo dpkg-reconfigure -plow unattended-upgrades  # responder "Yes"

# 3. Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker budi
# Salir y volver a entrar para que el grupo aplique.

# 4. Estructura de carpetas
sudo mkdir -p /srv/budi /srv/budi/caddy_data /srv/budi/caddy_config
sudo chown -R budi:budi /srv/budi
```

---

## 4. Configuración inicial (en el VPS)

```bash
cd /srv/budi

# Copiar de tu máquina (o `git clone` si el repo es accesible):
#   docker-compose.prod.yml
#   deploy/Caddyfile
#   .env.production  (NUNCA lo subas al repo)

# Ajustar el Caddyfile al dominio real (reemplazar app.budi.sv)
$EDITOR deploy/Caddyfile

# Permisos del archivo de secretos
chmod 600 .env.production
```

DNS: apuntar registro A de `app.budi.sv` (o el dominio que sea) al IP del VPS antes del primer `up`, así Caddy puede emitir el certificado.

---

## 5. Primer deploy

GitHub Actions builds and pushes the image to GHCR on every push to
`main` (see `.github/workflows/build-web-image.yml`). The first-deploy
flow on the VPS is therefore just `docker pull` + `up`:

```bash
# En el VPS (una vez):
# Login a GHCR con un PAT que tenga read:packages.
echo "$GHCR_PAT" | docker login ghcr.io -u <github-user> --password-stdin

cd /srv/budi
docker pull ghcr.io/<owner>/budi-web:latest
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f
```

Si la imagen es pública en GHCR no se necesita login. Hacerla pública
desde GitHub: Profile → Packages → budi-web → Package settings →
"Change visibility" → Public.

Alternativa antigua (sin GHA, para emergencias): `docker save | scp`:

```bash
# Sin CI:
docker build -f apps/web/Dockerfile -t budi-web:latest .
docker save budi-web:latest | gzip > budi-web.tar.gz
scp budi-web.tar.gz budi@VPS_IP:/srv/budi/
ssh budi@VPS_IP "cd /srv/budi && docker load < budi-web.tar.gz && docker compose -f docker-compose.prod.yml up -d"
```

---

## 6. Re-deploy

Con GHA configurado:

```bash
# Local: push a main, CI builda y pushea la imagen.
git push origin main

# VPS:
cd /srv/budi
docker pull ghcr.io/<owner>/budi-web:latest
docker compose -f docker-compose.prod.yml up -d web
```

`up -d web` re-crea sólo el contenedor web; Caddy y sus certs persisten.

`up -d web` re-crea sólo el contenedor web sin tocar Caddy (los certs persisten).

---

## 7. Operación día-a-día

| Tarea | Comando |
|---|---|
| Ver logs web | `docker compose -f docker-compose.prod.yml logs -f web` |
| Ver logs Caddy | `docker compose -f docker-compose.prod.yml logs -f caddy` |
| Restart web | `docker compose -f docker-compose.prod.yml restart web` |
| Aplicar migración DB | (desde tu máquina) `pnpm db:migrate` o `supabase db push --linked` |
| Regenerar database.types tras schema change | `pnpm db:types`, commit, redeploy |
| Rotar service role key | Supabase Dashboard → Settings → API → rotate; editar `.env.production`; `restart web` |
| Setear `ALLOWED_ORIGINS` en prod | `supabase secrets set ALLOWED_ORIGINS=https://app.budi.sv --project-ref qmjpotnmiusxyfujhdqp` |
| Redeploy una Edge Function | `supabase functions deploy <name> --project-ref qmjpotnmiusxyfujhdqp` |
| Ver uso de disco | `docker system df` |
| Limpiar imágenes viejas | `docker image prune -f` |

---

## 8. Lo que falta cerrar antes del primer deploy real

Independiente del provisioning del VPS, hay items del [CHECKLIST.md](./CHECKLIST.md) y [DIAGNOSTIC.md](./DIAGNOSTIC.md) que conviene resolver antes de exponer la app:

- [x] ~~**CORS estrecho** en las 5 Edge Functions Supabase (CHECKLIST A.4)~~ — código listo; falta `supabase secrets set ALLOWED_ORIGINS=https://app.budi.sv --project-ref qmjpotnmiusxyfujhdqp` cuando tengas dominio.
- [x] ~~**`get-eta` con JWT** (DIAGNOSTIC §1.2)~~ — resuelto (commit d5dc8c2): config.toml verify_jwt=true + autorización per-request dentro de la function. Requiere redeploy: `supabase functions deploy get-eta`.
- [x] ~~**PIN rate-limit + lockout** (DIAGNOSTIC §1.1)~~ — resuelto (migración 00025, commits a832920/07fbe76). Aplicar con `pnpm db:migrate` o `supabase db push --linked` al deployar.
- [x] ~~**PIN a SecureStore en móvil** (DIAGNOSTIC §1.4)~~ — resuelto (commits c389cbe/c90a7a5). Cubierto por wrapper `features/pin/lib/pinStorage.ts` con migración legacy. Rebuildear app móvil para que la migración se ejecute en devices con PINs viejos.
- [ ] **`database.types.ts` generado y consumido** (DIAGNOSTIC §1.5).
- [x] ~~**Sentry integrado** (CHECKLIST §5)~~ — wiring listo para web y móvil (commits 4132f6a / 1318787). No-op sin DSN. Para activar:
  1. Crear proyectos en sentry.io (uno para `budi-mobile`, otro para `budi-web`).
  2. **Web**: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` en `.env.production` y en GitHub Actions secrets (para upload de sourcemaps en build).
  3. **Mobile**: `EXPO_PUBLIC_SENTRY_DSN` como EAS Secret (Expo dashboard → Secrets). Native build requerido (no funciona en Expo Go).
  4. Edge Functions Supabase: postergado — el `console.error` actual + Supabase Logs Explorer alcanza para MVP.
  5. Opcional: `NEXT_PUBLIC_SENTRY_ENV=production` (o `staging`) para separar entornos. Desde 2026-09-28 la web tapa en cada evento los tokens que viajan en la URL (invitación, sesión, `code` PKCE) y cabeceras de credenciales (`src/shared/lib/sentry-scrub.ts`), y `app/error.tsx` + `app/global-error.tsx` reportan los errores de render.
- [ ] **Alertas operativas al canal del equipo** (migr. 00117, LAN-03). El panel ya muestra el aviso fijo a ADMIN y SUPPORT sin configurar nada. Para que además llegue a Slack/Google Chat/Discord, crear un webhook entrante y guardarlo en Vault:
  `select vault.create_secret('https://hooks.slack.com/services/…', 'ops_alert_webhook_url');`
  Sin el secreto `notify_ops()` no hace nada. Solo manda folio y tipo de servicio (sin datos personales).
- [x] ~~**Límite de frecuencia en Edge Functions** (migr. 00116, LAN-02)~~ — get-eta 60/min y calculate-distance 30/min por persona; import-members 60/min por IP antes de validar la clave y 30/min por aseguradora. Responde 429 con `Retry-After`. Requiere redeploy de las 3 funciones.
- [ ] Decidir dominio (`app.budi.sv` o el que sea) y comprar/configurar DNS.
- [ ] Proveedor VPS elegido y aprovisionado.

---

## 9. Riesgos conocidos

1. **Standalone output + monorepo pnpm** — depende de `outputFileTracingRoot` en `next.config.ts`. Revalidar tras upgrade de Next 17+.
2. ~~**`MOP_WHATSAPP_TO` hardcodeado**~~ — ya no aplica: el rol MOP y su Edge Function `notify-mop-whatsapp` se eliminaron en la migración 00045. La variable puede retirarse del entorno.
3. **Sin CI que buildee/pushee la imagen** — hoy el build es manual desde tu máquina. Cuando estabilice, GitHub Actions con `docker/build-push-action` a GHCR.
4. **Backups del VPS** — el único estado persistente local son los volúmenes de Caddy (`caddy_data`, `caddy_config`). Los certificados son re-emitibles, así que el VPS es básicamente stateless. Si se rompe, redeploy desde cero en otro VPS toma <30 min.
5. **Single point of failure** — un VPS sin reverse proxy ni load balancer no tolera caída. Para MVP es aceptable; para crecimiento considerar Hetzner Load Balancer + 2 VPS detrás.

Ver también: [DIAGNOSTIC.md](./DIAGNOSTIC.md), [CHECKLIST.md](./CHECKLIST.md).
