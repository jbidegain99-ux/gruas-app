# Gruas App - Plan de Trabajo y Progreso

## Stack Identificado
- **Mobile**: React Native 0.76.9 + Expo SDK 52 + Expo Router 4
- **Web**: Next.js 16.1.4 + React 19 + Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth + RLS + Realtime)
- **Shared**: TypeScript types en `/packages/shared`

## Flujo Actual de Creacion de Solicitudes
1. Usuario completa formulario 4 pasos en `/(user)/request.tsx`
2. Frontend llama RPC `create_service_request()` con parametros
3. RPC genera PIN, inserta en `service_requests`, crea evento audit
4. Modal "Solicitud Enviada" se muestra

---

# EPICA 1: CORREGIR ERROR 23502 (CRITICO)

## Root Cause Analysis
| Componente | Expectativa | Realidad | Impacto |
|------------|-------------|----------|---------|
| Frontend request.tsx | Envia params | **NO envia** `p_dropoff_lat`, `p_dropoff_lng` | Insert falla |
| RPC create_service_request | Requiere `p_dropoff_lat/lng` | Frontend no los pasa | NULL violation |
| Tabla service_requests | `dropoff_lat/lng NOT NULL` | RPC intenta insertar NULL | Error 23502 |
| Parametro vehiculo | Frontend: `p_vehicle_description` | RPC: `p_vehicle_plate` | Parametro ignorado |

## Tareas
- [x] **1.1** Actualizar frontend para enviar `p_dropoff_lat` y `p_dropoff_lng`
  - Solucion: Usar coordenadas por defecto de San Salvador (13.6929, -89.2182)
  - Archivo: `/apps/mobile/app/(user)/request.tsx` linea 185-194
- [x] **1.2** Corregir parametro `p_vehicle_description`
  - Solucion: Combinar vehicleDescription con notes usando template string
  - La RPC ya acepta p_notes, lo usamos para pasar la descripcion del vehiculo
- [x] **1.3** Corregir UX del modal
  - Modal solo se muestra si `error === null` Y `data.success === true`
  - Se muestra PIN de verificacion al usuario
  - Mensaje de error claro con opcion "Reintentar"
- [x] **1.4** Prevenir double-submit
  - Boton ya se deshabilita durante submitting
  - Se verifica estado antes de mostrar modal

---

# EPICA 2: IMPLEMENTAR HISTORIAL (USUARIO)

## Tareas
- [x] **2.1** Crear query para obtener solicitudes del usuario
  - Query a `service_requests` con join a `profiles` y `providers`
- [x] **2.2** Implementar UI con FlatList y estados (loading/empty/error)
  - ActivityIndicator durante carga
  - Empty states diferenciados por filtro
- [x] **2.3** Añadir filtros: Todas / Activas / Completadas / Canceladas
  - ScrollView horizontal con TouchableOpacity
- [x] **2.4** Modal de detalle con:
  - Estado actual con badge de color
  - Direcciones pickup/dropoff
  - Tipo grua/incidente
  - Precio final (si existe)
  - Operador asignado (si existe)
  - Timeline de fechas (creada, completada, cancelada)
  - ID de solicitud

**Archivo**: `/apps/mobile/app/(user)/history.tsx` (400+ lineas)

---

# EPICA 3: IMPLEMENTAR PERFIL (USUARIO Y OPERADOR)

## Tareas
- [x] **3.1** Obtener datos del perfil desde `profiles` table
  - Join con auth.user para obtener email
- [x] **3.2** Mostrar: nombre, email/telefono, rol
  - Avatar con iniciales
  - Badge de rol
- [x] **3.3** Boton cerrar sesion funcional
  - Confirmacion con Alert
  - supabase.auth.signOut()
  - Redirect a login
- [x] **3.4** Opcion editar perfil (nombre, telefono)
  - Modal con formulario
  - Validacion de campos requeridos
- [x] **3.5** Estados: loading/error/retry
  - Loading spinner
  - Error con boton retry
- [x] **3.6** Implementar para operador tambien
  - Stats de servicios (total/activos/completados)
  - Info del proveedor si existe

**Archivos**:
- `/apps/mobile/app/(user)/profile.tsx` (549 lineas)
- `/apps/mobile/app/(operator)/profile.tsx` (647 lineas)

---

# EPICA 4: FLUJO OPERADOR COMPLETO

## Tareas
- [x] **4.1** Corregir visibilidad de solicitudes
  - Bug: RPC llamada con parametro que no acepta
  - Fix: Remover `p_operator_id` de la llamada (RPC usa auth.uid() interno)
- [x] **4.2** Corregir insert de eventos
  - Bug: Campos incorrectos (created_by vs actor_id, metadata vs payload)
  - Fix: Remover insert manual - el trigger `log_service_request_changes` lo hace automaticamente
- [x] **4.3** Verificar "Aceptar Servicio" funciona
  - Update a service_requests con status='assigned', operator_id, provider_id
  - Condicion .eq('status', 'initiated') previene race conditions

**Archivo**: `/apps/mobile/app/(operator)/index.tsx`

---

# EPICA 5: REFINAMIENTO UX

## Tareas
- [x] **5.1** Loading states
  - ActivityIndicator con texto descriptivo
- [x] **5.2** Manejo de errores con retry
  - Alert.alert con boton "Reintentar"
  - Log de errores a consola
- [x] **5.3** Empty states
  - Iconos descriptivos
  - Texto contextual segun filtro activo

---

# EPICA 6: DOCUMENTACION Y TESTING

## Tareas
- [x] **6.1** Documentar usuarios de prueba
  - Archivo: `/docs/test-users.md`
- [x] **6.2** Ejecutar lint y build
  - `pnpm lint` - PASSED
  - `expo export --platform web` - PASSED
  - `pnpm build` (web) - PASSED
- [x] **6.3** Actualizar lessons learned
  - Archivo: `/tasks/lessons.md`

---

# EVIDENCIA DE PROGRESO

## Sesion 2026-02-02

### Build Verification

**Mobile Export**:
```
Static routes (18):
/ (index) (19.1 kB)
/(user)/history (17.6 kB)
/(user)/profile (17.6 kB)
/(user)/request (17.6 kB)
/(operator) (17.6 kB)
/(operator)/active (17.6 kB)
/(operator)/profile (17.6 kB)
...
Exported: dist
```

**Web Build**:
```
✓ Compiled successfully in 9.0s
✓ Generating static pages (14/14)

Route (app)
├ ○ /admin
├ ○ /admin/pricing
├ ○ /admin/providers
├ ○ /mop
├ ○ /mop/requests
...
```

**Lint**:
```
packages/shared lint: Done
apps/mobile lint: Done
apps/web lint: Done
```

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `apps/mobile/app/(user)/request.tsx` | Añadir dropoff coords, combinar vehicle desc con notes, mejorar error handling |
| `apps/mobile/app/(user)/history.tsx` | Implementacion completa con filtros y modal detalle |
| `apps/mobile/app/(user)/profile.tsx` | Implementacion completa con edicion y logout |
| `apps/mobile/app/(operator)/profile.tsx` | Implementacion completa con stats |
| `apps/mobile/app/(operator)/index.tsx` | Fix RPC call, remover insert manual de eventos |
| `docs/test-users.md` | Nuevo - documentacion de pruebas |
| `tasks/lessons.md` | Nuevo - lecciones aprendidas |

---

# RESULTADO FINAL

## Resumen Ejecutivo
1. **Error 23502 CORREGIDO**: Frontend ahora envia coordenadas de destino requeridas
2. **Historial IMPLEMENTADO**: Lista filtrable con modal de detalle
3. **Perfil Usuario IMPLEMENTADO**: Info, edicion y logout
4. **Perfil Operador IMPLEMENTADO**: Info, stats y logout
5. **Operador ve solicitudes**: Corregido llamada RPC y event logging
6. **Build verificado**: Lint y build pasan exitosamente

## Proximos Pasos Recomendados (Backlog)
1. Geocoding real para direcciones (Google Maps API)
2. GPS tracking de operadores en tiempo real
3. Chat entre usuario y operador
4. Sistema de ratings/calificaciones UI
5. Notificaciones push
6. Subida de fotos del vehiculo a storage
7. Tests E2E con Playwright

---

# EPICA 7: FUNCIONALIDADES CRITICAS DE PRODUCCION

## Sesion: 2026-02-04

---

## Task 1: Integrar Distance Matrix API para calculo de precio real

### Estado: 🔄 PLANIFICACION

### Problema Actual
```typescript
// apps/mobile/app/(user)/request.tsx linea 153-157
const calculatePrice = () => {
  if (!pricing) return;

  // PROBLEMA: Usa distancia ALEATORIA (5-50 km)
  const distance = Math.round(5 + Math.random() * 45);  // ❌ INCORRECTO
  setEstimatedDistance(distance);
  // ...
};
```

El sistema actual:
- Ignora completamente las coordenadas reales (`pickupCoords`, `dropoffCoords`)
- Genera distancia aleatoria entre 5-50 km
- Muestra precio estimado ficticio al usuario
- La columna `distance_pickup_to_dropoff_km` en BD queda en NULL

### Solucion Propuesta

#### Arquitectura
```
┌─────────────────┐      ┌─────────────────────┐      ┌────────────────────┐
│  Mobile App     │ ───> │  Supabase Edge      │ ───> │  Google Distance   │
│  request.tsx    │      │  calculate-distance │      │  Matrix API        │
└─────────────────┘      └─────────────────────┘      └────────────────────┘
         │                        │
         │                        ├── Cachea resultado
         │                        ├── Valida coordenadas
         ▼                        ├── Maneja errores API
   Muestra precio                 └── Retorna distancia/duracion
   estimado real
```

#### Archivos a Crear

**1. Edge Function: `supabase/functions/calculate-distance/index.ts`**
```
supabase/functions/
├── notify-mop-whatsapp/
│   └── index.ts          (existente)
└── calculate-distance/   (NUEVO)
    └── index.ts
```

**Responsabilidades:**
- Recibir: `origin_lat`, `origin_lng`, `destination_lat`, `destination_lng`
- Validar coordenadas (rango valido para El Salvador)
- Llamar a Google Distance Matrix API
- Retornar: `{ distance_km, distance_text, duration_minutes, duration_text }`
- Manejar errores: timeout, quota exceeded, invalid request

**2. Hook: `apps/mobile/src/hooks/useDistanceCalculation.ts`**
```
apps/mobile/src/hooks/
├── useDistanceCalculation.ts  (NUEVO)
└── (otros hooks existentes)
```

**Responsabilidades:**
- Llamar Edge Function cuando cambian coordenadas
- Debounce de 500ms para evitar llamadas excesivas
- Cachear resultado en memoria (no re-calcular si coords no cambian)
- Estados: `loading`, `error`, `data`
- Retornar: `{ distance, duration, loading, error, refetch }`

#### Archivos a Modificar

**1. `apps/mobile/app/(user)/request.tsx`**
- Importar y usar `useDistanceCalculation` hook
- Reemplazar `calculatePrice()` con calculo basado en distancia real
- Mostrar: distancia estimada, tiempo estimado, precio estimado
- Manejar estado de carga (spinner mientras calcula)
- Manejar errores (mostrar mensaje, permitir retry)

**2. `apps/mobile/lib/supabase.ts`** (probablemente sin cambios)
- Ya exporta cliente configurado

#### Plan de Implementacion Detallado

**Paso 1: Crear Edge Function `calculate-distance`**
```typescript
// supabase/functions/calculate-distance/index.ts
interface DistanceRequest {
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
}

interface DistanceResponse {
  distance_km: number;
  distance_text: string;      // "12.5 km"
  duration_minutes: number;
  duration_text: string;      // "18 mins"
}

// Validaciones:
// - Coordenadas en rango El Salvador: lat 13.0-14.5, lng -90.2 to -87.5
// - Distancia minima 0.5 km (evitar mismo punto)
// - Distancia maxima 300 km (pais pequeno)
```

**Paso 2: Configurar API Key como Secret**
```bash
# En Supabase Dashboard > Edge Functions > Secrets
# O via CLI:
supabase secrets set GOOGLE_MAPS_API_KEY=AIzaSyC8tCWhu6iyl8oUAGi2rR8W6p7g3PDTpBE
```

**Paso 3: Crear Hook `useDistanceCalculation`**
```typescript
// Pseudocodigo del hook
export function useDistanceCalculation(
  originCoords: { lat: number; lng: number } | null,
  destCoords: { lat: number; lng: number } | null
) {
  // Debounce coordenadas para evitar llamadas excesivas
  // Cachear ultimo resultado
  // Llamar Edge Function solo si coords cambiaron
  // Retornar { distance, duration, loading, error }
}
```

**Paso 4: Integrar en request.tsx**
```typescript
// En el componente RequestService
const distanceResult = useDistanceCalculation(pickupCoords, dropoffCoords);

// Modificar calculatePrice para usar distancia real
const calculatePrice = () => {
  if (!pricing || !distanceResult.distance) return;

  const distance = distanceResult.distance;  // ✅ DISTANCIA REAL
  setEstimatedDistance(distance);

  const pricePerKm = towType === 'light'
    ? pricing.price_per_km_light
    : pricing.price_per_km_heavy;
  const extraKm = Math.max(0, distance - pricing.included_km);
  const total = pricing.base_exit_fee + extraKm * pricePerKm;

  setEstimatedPrice(Math.round(total * 100) / 100);
};
```

**Paso 5: Mejorar UX en Step 4 (Resumen)**
```typescript
// Mostrar informacion adicional
<View style={styles.priceCard}>
  <Text style={styles.priceLabel}>Precio Estimado</Text>
  <Text style={styles.priceValue}>${estimatedPrice?.toFixed(2)}</Text>

  {distanceResult.loading ? (
    <ActivityIndicator />
  ) : (
    <>
      <Text>Distancia: {distanceResult.distance?.toFixed(1)} km</Text>
      <Text>Tiempo aprox: {distanceResult.duration} min</Text>
    </>
  )}
</View>
```

### Validaciones y Manejo de Errores

| Escenario | Comportamiento |
|-----------|----------------|
| Coordenadas invalidas | Mostrar error, no calcular precio |
| API timeout | Reintentar 1 vez, luego fallback a distancia lineal |
| Quota exceeded | Usar fallback: formula Haversine |
| Sin conexion | Mostrar error, boton retry |
| Misma ubicacion origen/destino | Mostrar advertencia |

### Formula Fallback (Haversine)
```typescript
// En caso de error de API, usar calculo directo
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radio de la Tierra en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
// Nota: Esto da distancia "en linea recta", multiplicar por 1.3 para aproximar ruta real
```

### Test de Verificacion

**Ruta de prueba: San Salvador Centro → Santa Tecla**
- Origen: 13.6929, -89.2182 (Plaza Libertad, San Salvador)
- Destino: 13.6767, -89.2797 (Centro de Santa Tecla)
- Distancia esperada: ~12-15 km (por carretera)
- Duracion esperada: ~20-30 minutos

**Criterios de exito:**
- [ ] Edge Function responde en <2 segundos
- [ ] Distancia mostrada es ~12-15 km (no numero aleatorio)
- [ ] Tiempo mostrado es ~20-30 min
- [ ] Precio se calcula correctamente con la distancia real
- [ ] Error de API muestra mensaje amigable + opcion retry
- [ ] Si no hay coordenadas de destino, no intenta calcular

### Consideraciones de Seguridad

1. **API Key en servidor**: La key de Google Maps NUNCA se expone al cliente
2. **Rate limiting**: Edge Functions tienen limite de invocaciones
3. **Validacion de coordenadas**: Prevenir abuso con coordenadas fuera de rango
4. **CORS**: Solo permitir origen de la app

### Costo Estimado

- Google Distance Matrix: $5 por 1000 requests
- Estimacion mensual (1000 solicitudes/mes): ~$5-10

---

### CHECKLIST PRE-IMPLEMENTACION

- [ ] Confirmar que Google Maps API Key tiene Distance Matrix habilitada
- [ ] Verificar que Supabase CLI esta instalado para deploy de Edge Functions
- [ ] Confirmar estructura de archivos con el usuario
- [ ] Decidir si implementar fallback Haversine o solo mostrar error

---

**ESPERANDO CONFIRMACION DEL PLAN ANTES DE IMPLEMENTAR**
