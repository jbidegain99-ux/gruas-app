# Tracking de ubicación en segundo plano (operador)

> **Estado:** implementado en código. Corre **sólo en un development build** —
> en Expo Go y en web degrada automáticamente a tracking de primer plano, sin
> errores.

Con la app en primer plano, `useOperatorLocationTracking` transmite con
`watchPositionAsync`. Cuando el operador minimiza la app o bloquea la pantalla
—lo normal si va conduciendo— toma el relevo la tarea de fondo.

## Piezas

| Archivo | Rol |
|---|---|
| `features/tracking/lib/backgroundLocationTask.ts` | Define la tarea (`budi-operator-location`) y expone `startBackgroundTracking` / `stopBackgroundTracking`. |
| `features/tracking/hooks/useOperatorLocationTracking.ts` | Arranca la tarea junto al watcher de primer plano y la detiene al parar. |
| `app/_layout.tsx` | Importa el módulo al arrancar para que `defineTask` quede registrada. |
| `app.json` | Permisos de background y foreground service (Android) + `UIBackgroundModes` (iOS). |

Ambos tracks escriben en el mismo RPC `upsert_operator_location`, así que
`operator_locations` y el mapa de flota (`/admin/fleet`) no cambian.

## Degradación (importante)

`isBackgroundLocationSupported()` devuelve **false** en web y en Expo Go
(`Constants.executionEnvironment === StoreClient`). En esos entornos:

- `defineTask` ni se registra,
- `startBackgroundTracking()` devuelve `false` sin lanzar excepción,
- el operador sigue transmitiendo normalmente **mientras la app esté abierta**.

Por eso agregar esto **no rompe las pruebas actuales en Expo Go**.

También devuelve `false` —sin romper nada— si el usuario niega el permiso de
ubicación "siempre", o si `DEMO_CONFIG.ENABLED` está activo.

## Probarlo de verdad (requiere development build)

```bash
# opción A: build local (necesita Android SDK / Xcode)
pnpm --filter mobile exec npx expo run:android

# opción B: EAS (necesita eas.json y la cuenta Expo — todavía pendiente)
eas build --profile development --platform android
```

Luego, en el teléfono:
1. Iniciar sesión como operador y ponerse **En línea**.
2. Aceptar el permiso de ubicación **"Permitir siempre"** (Android lo pide aparte).
3. Minimizar la app → debe quedar una notificación persistente
   *"Budi — transmitiendo ubicación"*.
4. Moverse y confirmar que la posición sigue cambiando en `/admin/fleet`.

## Notas

- Android exige un **foreground service** visible para ubicación en background:
  es la notificación persistente, no se puede ocultar.
- iOS pide el permiso "Siempre" por separado y el usuario puede degradarlo en
  cualquier momento; por eso nunca se asume que está concedido.
- La tarea puede correr en un contexto JS recién arrancado: antes de enviar
  verifica que haya sesión de Supabase, porque si no RLS rechaza el RPC.
- Se detiene siempre al ponerse fuera de línea o cerrar el servicio, para no
  drenar batería ni transmitir de más.
