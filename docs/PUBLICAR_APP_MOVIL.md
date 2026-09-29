# Publicar la app móvil (Android + iOS)

Guía para llevar `apps/mobile` a Google Play y a la App Store. La app ya está
construida; esto cubre compilarla, firmarla y publicarla con EAS (Expo
Application Services).

## Lo que ya está hecho en el código (Fase 1, 2026-09-25)

| Qué | Dónde |
|---|---|
| Nombre **Budi**, identificador **`com.budisv.app`** (permanente una vez publicado) | `apps/mobile/app.config.ts` |
| Tres variantes que conviven en el mismo teléfono: `Budi (dev)` `.dev`, `Budi (prueba)` `.preview`, `Budi` (tiendas) | `app.config.ts` + `eas.json` (`APP_VARIANT`) |
| Íconos 1024×1024 (iOS), adaptable (Android), splash, notificación | `apps/mobile/assets/` |
| Textos de permisos en español, con la justificación de la ubicación en segundo plano | `app.config.ts` → `infoPlist`, `expo-location` |
| Llave de Google Maps **fuera del repo** (variable de entorno) | `app.config.ts` |
| Actualizaciones por aire (`expo-updates`, `runtimeVersion: appVersion`, canales por perfil) | `app.config.ts`, `eas.json` |
| **Eliminar la cuenta** desde la app (Perfil) y desde la web (`/eliminar-cuenta`) | migr. `00101`, función `delete-account` |
| Aviso de privacidad actualizado (aseguradora, MOPT, eliminación) | `/privacidad` |

## Lo que tenés que hacer vos

### 1. Cuentas (empezar ya: tardan)
- **Número D-U-N-S** de la empresa (gratis, puede tardar días o semanas). Lo
  piden Apple y Google para cuentas de empresa.
- **Apple Developer Program** como organización (USD 99/año).
- **Google Play Console** como organización (USD 25, una vez). Una cuenta
  personal nueva obliga a 14 días de prueba cerrada con 12 testers antes de
  publicar; la de organización no.
- **Cuenta de Expo** (gratis) para EAS.

### 2. Llave de Google Maps
La llave que estaba escrita en el antiguo `app.json` quedó en el historial de
git. En Google Cloud Console:
1. Crear llaves nuevas (una para Android, una para iOS).
2. Restringir la de Android al paquete `com.budisv.app` + huella SHA-1 de la
   firma (EAS la muestra en `eas credentials`); la de iOS al bundle
   `com.budisv.app`.
3. **Revocar la llave vieja**.
4. Cargarla en EAS: `eas env:create --name GOOGLE_MAPS_API_KEY --environment production --visibility secret`.

### 3. Conectar el proyecto a EAS
```bash
cd apps/mobile
npx eas-cli login
npx eas-cli init          # crea el proyecto y muestra el projectId
```
Como la configuración es dinámica (`app.config.ts`), `eas init` no puede
escribir el id solo: cargalo como variable `EAS_PROJECT_ID` (o escribilo en
`app.config.ts`). Lo necesitan push y las actualizaciones por aire.

Variables por entorno (`eas env:create`): `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_MAPS_API_KEY`, `EXPO_PUBLIC_SENTRY_DSN`,
`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (secreto).

### 4. Credenciales de push
- **Android:** proyecto en Firebase → descargar la cuenta de servicio (FCM v1) →
  `eas credentials` → Android → Push Notifications.
- **iOS:** `eas credentials` genera la llave APNs con tu cuenta de Apple.

### 5. Backend de producción (decisión tuya)
Las apps de tienda apuntan a Supabase en la nube, que está en la migración
00024. Antes de publicar:
1. Probar la cadena completa sobre una base limpia (`supabase db reset` en un
   entorno aparte).
2. Aplicar 00025–00101 y desplegar las Edge Functions (incluida
   `delete-account`).
3. Crear cuentas de demo para los revisores de Apple y Google (un usuario y un
   operador aprobado) con datos que funcionen.

## Builds

| Perfil | Para qué | Comando |
|---|---|---|
| `development` | Desarrollo con recarga en caliente (reemplaza Expo Go) | `eas build -p android --profile development` |
| `preview` | Probar en teléfonos reales, instalable directo | `eas build -p android --profile preview` / `-p ios` |
| `production` | Tiendas | `eas build -p all --profile production` |

iOS en `preview` necesita registrar los teléfonos: `eas device:create`.

**Probar en teléfono real sí o sí** (no funciona en Expo Go ni en web):
seguimiento en segundo plano del operador, push, mapas nativos, cámara y
documentos, PIN, flujo MOPT completo, eliminar cuenta.

## Fichas de las tiendas
- Descripción, capturas (teléfono), ícono de 512 (Google) — se puede exportar de
  `assets/icon.png`.
- Política de privacidad: `https://<dominio>/privacidad`.
- URL para eliminar la cuenta (Google): `https://<dominio>/eliminar-cuenta`.
- Google: formulario **Seguridad de los datos** y **declaración de ubicación en
  segundo plano** con un video corto mostrando al operador en servicio.
- Apple: etiqueta de privacidad y la explicación del permiso "Siempre".

## Publicar
```bash
eas submit -p android --profile production   # sube a Play (prueba interna primero)
eas submit -p ios --profile production       # sube a TestFlight
```
Android: prueba interna → cerrada → producción con lanzamiento escalonado.
iOS: TestFlight interno → externo → App Store.

## Después de publicar
- Arreglos de JavaScript: `eas update --channel production` (sin revisión).
- Cambios nativos (permisos, librerías con código nativo): subir `version` en
  `app.config.ts` y hacer build nuevo; `runtimeVersion` evita que una
  actualización por aire llegue a un binario incompatible.
