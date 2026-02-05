# GruasApp Phase 2 - Investigacion y Correcciones

## Investigacion Task 0 - COMPLETADA

### 0.1 Chat - HALLAZGOS

**Estado: YA IMPLEMENTADO**

El usuario YA tiene acceso completo al chat:
- `ChatScreen` importado en `apps/mobile/app/(user)/index.tsx:17`
- Estado `showChat` definido en linea 82
- Boton "Chat con Operador" visible cuando hay operador asignado (lineas 476-484)
- `ChatScreen` renderizado cuando `showChat` es true (lineas 268-277)
- Usa la tabla `request_messages` con RPC `send_message`
- Realtime subscription funciona via `.channel('chat:${requestId}')`

**Conclusion Task 1:** NO REQUIERE TRABAJO - Ya esta funcionando.

---

### 0.2 Fotos - HALLAZGOS

**Estado: PARCIALMENTE IMPLEMENTADO - NO FUNCIONA**

El usuario puede capturar fotos pero NO se guardan:
- Estado `photo` existe en `request.tsx:64`
- UI de fotos existe: botones "Tomar Foto" y "Galeria" (lineas 526-536)
- `ImagePicker` de expo correctamente configurado (lineas 203-231)
- Preview de foto funciona localmente

**PROBLEMA CRITICO:**
- El RPC `create_service_request` (linea 289) NO incluye el parametro de foto
- No existe columna `vehicle_photo_url` en tabla `service_requests`
- Buckets existentes: `id-documents`, `vehicle-documents` (para operadores)
- NO existe bucket para fotos de solicitudes de usuarios

**Solucion requerida:**
1. Crear bucket `service-photos` en Supabase Storage
2. Agregar columna `vehicle_photo_url` a `service_requests`
3. Modificar `request.tsx` para subir foto antes de crear solicitud
4. Modificar RPC `create_service_request` para aceptar `p_vehicle_photo_url`
5. Mostrar foto en vista del operador (`apps/mobile/app/(operator)/index.tsx`)

**Conclusion Task 2:** REQUIERE IMPLEMENTACION

---

### 0.3 Mapa con ETA - HALLAZGOS

**Estado: YA IMPLEMENTADO**

El usuario YA tiene mapa en tiempo real con ETA:
- Hook `useOperatorRealtimeTracking.ts` para ubicacion en tiempo real via Realtime
- Hook `useETA.ts` con:
  - Throttling de 60 segundos entre llamadas
  - Solo actualiza si operador se movio >100 metros
  - Usa Edge Function `get-eta`
- MapView en `apps/mobile/app/(user)/index.tsx` mostrando:
  - Marcador de pickup (verde)
  - Marcador del operador (azul, se mueve en tiempo real)
- Seccion de ETA con tiempo estimado y distancia (lineas 383-410)

**Conclusion Task 3:** NO REQUIERE TRABAJO - Ya esta funcionando.

---

## Resumen de Tareas

| Task | Estado | Accion |
|------|--------|--------|
| Task 1: Chat Usuario | YA IMPLEMENTADO | Ninguna |
| Task 2: Fotos | IMPLEMENTADO | Migracion + Frontend completado |
| Task 3: Mapa + ETA | YA IMPLEMENTADO | Ninguna |

---

## Plan de Implementacion - Task 2: Fotos

### Paso 1: Crear migracion SQL
- Agregar columna `vehicle_photo_url TEXT` a `service_requests`
- Crear bucket `service-photos` con politicas RLS

### Paso 2: Modificar frontend del usuario
- En `request.tsx`: subir foto a Storage antes de crear solicitud
- Pasar URL al RPC (modificar RPC o guardar en notes)

### Paso 3: Mostrar foto al operador
- En `apps/mobile/app/(operator)/index.tsx`: mostrar miniatura
- En `apps/mobile/app/(operator)/active.tsx`: mostrar foto completa

### Paso 4: Probar end-to-end
- Usuario crea solicitud con foto
- Operador ve la foto en la lista y en detalle

---

## Historial

### Fase Anterior (Completada)
- [x] RPCs creados: `rate_service`, `send_message`, `upsert_operator_location`
- [x] Rating modal cambiado de popup a lista
- [x] Push notifications al cambiar estado
- [x] Pantalla de ratings para operador
- [x] Vista de ratings en admin web
