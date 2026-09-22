---
name: smoke-mobile-web
description: Smoke test de la app móvil (apps/mobile, Expo) corriéndola en Expo Web y conduciéndola con Playwright headless. Login real + navegación de pantallas autenticadas (USER y OPERATOR) contra Supabase local, capturando errores de runtime y screenshots. Úsalo para confirmar que la móvil arranca, renderiza y se usa sin imports rotos — p. ej. tras refactors de estructura. NO cubre mapa/tracking nativo (eso requiere Android real).
---

# Smoke test de la app móvil vía Expo Web

Corre la app **real** (no el test suite) en el navegador vía `react-native-web`,
hace login y navega las pantallas autenticadas de ambos roles. El bundler web de
Metro usa la misma resolución de módulos que el nativo, así que **0 errores de
módulo aquí ⇒ la estructura de imports está sana**.

## Qué prueba y qué NO

- ✅ Arranque, render, login real contra Supabase, navegación USER + OPERATOR, imports.
- ❌ **Mapa / tracking en tiempo real**: necesita `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
  y código nativo → no renderiza en web. Para eso usa Android real (emulador / Expo Go).
- ❌ **Edge Functions** (`get-eta`, etc.): el `edge_runtime` de Supabase local suele
  estar **Stopped** → la ETA no se calcula. No es un fallo de la app.

## Requisitos previos (verificar, no asumir)

1. **Supabase local corriendo** — health debe dar 200:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:54321/auth/v1/health
   ```
   Si no, `npx supabase start`. Las claves locales: `npx supabase status` (campo JSON
   `ANON_KEY`/`PUBLISHABLE_KEY`/`SERVICE_ROLE_KEY`).
2. **Usuarios de prueba en la DB local** (se pierden con `supabase db reset`):
   - `usuario1@gruas.sv` / `User123!` (USER)
   - `operador1@gruas.sv` / `Op123!` (OPERATOR)

   Verificar (usa el SERVICE_ROLE_KEY de `npx supabase status`):
   ```bash
   SR="<SERVICE_ROLE_KEY>"
   curl -s "http://127.0.0.1:54321/auth/v1/admin/users?per_page=100" \
     -H "apikey: $SR" -H "Authorization: Bearer $SR" \
     | grep -oE '"email":"[^"]+"|"role":"[^"]+"'
   ```
   Si faltan, crearlos por la admin API: `POST /auth/v1/admin/users` con
   `{"email":...,"password":...,"email_confirm":true,"user_metadata":{"role":"USER"}}`
   (el trigger `handle_new_user` toma el rol de `raw_user_meta_data.role`).
3. **Chrome del sistema instalado** (el driver usa `channel:'chrome'`, no descarga browsers).
4. **`@playwright/test`** instalado en `apps/web` (ya es dep del proyecto).

## Procedimiento

> El `.env` de móvil normalmente apunta a la **IP LAN** (setup de teléfono físico).
> Para conducir desde la PC usa **loopback**. SIEMPRE respaldá y restaurá el `.env`.

```bash
cd "$(git rev-parse --show-toplevel)"

# 1. Backup + reapuntar host a loopback (la anon/publishable key local NO cambia)
cp apps/mobile/.env "$TEMP/mobile.env.backup"
sed -i -E "s#(EXPO_PUBLIC_SUPABASE_URL=)http://[0-9.]+:54321#\1http://127.0.0.1:54321#" apps/mobile/.env

# 2. Arrancar Expo web con --clear (reinyecta el env nuevo en el bundle). En background.
( cd apps/mobile && BROWSER=none CI=1 npx expo start --web --port 8081 --clear > "$TEMP/expo-web.log" 2>&1 & )

# 3. Esperar a que :8081 responda
for i in $(seq 1 50); do curl -s -o /dev/null --max-time 3 http://localhost:8081 && { echo "listo"; break; }; sleep 3; done
```

```bash
# 4. Conducir el smoke test. cwd DEBE ser apps/web (ahí se resuelve @playwright/test).
OUT="$TEMP/smoke-mobile"; mkdir -p "$OUT"
( cd apps/web && OUT_DIR="$OUT" node ../../.claude/skills/smoke-mobile-web/driver.mjs )
# Mirá los screenshots de $OUT con la tool Read — un frame en blanco es un fallo de montaje.
```

```bash
# 5. SIEMPRE: restaurar .env y detener Metro
cp "$TEMP/mobile.env.backup" apps/mobile/.env
```
Detener Metro (Windows / PowerShell):
```powershell
Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -Expand OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```

## Lectura del resultado

El driver imprime un `VEREDICTO: PASS ✅ / REVISAR ⚠` y separa:
- **errores de módulo/import (CRÍTICOS)** → un refactor rompió algo; hay que arreglar.
- **otros errores reales** → revisar caso a caso.
- **ruido web conocido (ignorable)** → p. ej. `ExpoSecureStore ... is not a function`
  (feature PIN usa `expo-secure-store`, que no existe en web; en Android funciona).

`PASS` requiere: 0 errores de módulo **y** login exitoso de USER y OPERATOR.

## Gotchas (aprendidos a la mala)

- **`@playwright/test`, no `playwright`**: el paquete instalado es `@playwright/test`;
  exporta `chromium`. Resolverlo con `createRequire(join(process.cwd(),'package.json'))`
  desde `apps/web` (un `.mjs` en otra carpeta no lo encuentra por ESM normal).
- **`--clear` es obligatorio** al cambiar el `.env`: Expo hornea `EXPO_PUBLIC_*` en el
  bundle; sin `--clear` sirve el bundle viejo con la URL anterior y el login cuelga.
- **Loopback, no IP LAN**: conduciendo desde la PC, `192.168.x.x` puede no resolver bien
  en el navegador headless; `127.0.0.1` siempre.
- **Esperas generosas**: el primer `goto` compila el bundle web on-demand (~7s) y el
  login necesita ~11s para auth + montar el home. No bajar esos timeouts.
