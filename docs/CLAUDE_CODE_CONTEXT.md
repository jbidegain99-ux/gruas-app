# CONTEXTO COMPLETO - GruasApp/Budi Re-branding
## FECHA: 06 Feb 2026

---

## 🎯 OBJETIVO DE ESTA SESIÓN
Arreglar los 2 últimos problemas críticos de funcionalidad antes de production:
1. **Mapa de tracking NO visible** cuando servicio está asignado/en camino
2. **Iconos profesionales** en selector de servicios (reemplazar emojis)

---

## 📚 HISTORIA DEL PROYECTO

### Fase 1 (Completada hace semanas):
- ✅ Auth (email/password)
- ✅ Service requests con PIN
- ✅ GPS tracking operators
- ✅ Price calculation (Distance Matrix API)
- ✅ Navigation integration

### Fase 2 (Completada hace días):
- ✅ Dynamic ETA con traffic
- ✅ Rating system
- ✅ Chat functionality (Supabase Realtime)
- ✅ API cost optimization (distance caching)

### Re-branding Budi (Completado HOY):
- ✅ Design System v1.0 creado y documentado
- ✅ Logo generado (Gemini) y recreado como SVG (BudiLogo.tsx)
- ✅ Componentes base: Button, Input, Card, StatusBadge, LoadingSpinner
- ✅ Theme system: colors, typography, spacing, touch targets
- ✅ 7 pantallas user re-skinned (landing, login, register, home, request, history, profile)
- ✅ Safe Areas implementadas (8 screens)
- ✅ 4 pantallas operator re-skinned (index, active, ratings, profile)

---

## 🏗️ ARQUITECTURA ACTUAL

### Stack Técnico:
```
React Native (Expo SDK 54)
├── Frontend: TypeScript + React Native
├── Backend: Supabase (PostgreSQL + Edge Functions)
├── Maps: Google Maps API + Distance Matrix API
├── Realtime: Supabase Realtime (chat + tracking)
└── Location: /home/jose/gruas-app (monorepo pnpm)
```

### Estructura del Proyecto:
```
gruas-app/ (monorepo pnpm)
├── apps/
│   ├── mobile/                  App Expo (React Native)
│   │   ├── app/                 Rutas (expo-router) — SOLO routing/screens
│   │   │   ├── (auth)/          index · login · register
│   │   │   ├── (user)/          _layout · index · request · history · profile
│   │   │   └── (operator)/      _layout · index · active · ratings · profile
│   │   ├── features/            Código por dominio (components/hooks/lib)
│   │   │   ├── chat/            components/ChatScreen
│   │   │   ├── notifications/   hooks/usePushNotifications
│   │   │   ├── pin/             lib/pinStorage
│   │   │   ├── rating/          components/RatingModal
│   │   │   └── tracking/        components/LocationPicker
│   │   │                        hooks/ useActiveRequest · useETA
│   │   │                              useFallbackRoute · useGPSSimulator
│   │   │                              useOperatorLocationTracking
│   │   │                              useOperatorRealtimeTracking · useTrackingRoute
│   │   ├── shared/              Transversal (no atado a un dominio)
│   │   │   ├── components/ui/   Button · Input · Card · StatusBadge
│   │   │   │                    LoadingSpinner · BudiLogo · PINInput
│   │   │   └── hooks/           useBudiFonts · useDistanceCalculation
│   │   └── constants/           theme.ts (tokens del Design System)
│   │
│   └── web/                     App Next.js (App Router)
│       └── src/
│           ├── app/             Rutas — page.tsx hace re-export del feature
│           │   ├── admin/       page + pricing/providers/ratings/...
│           │   ├── mop/         page + requests
│           │   └── login/  register/
│           ├── features/        Páginas reales por dominio
│           │   ├── admin/       AdminDashboardPage · AdminPricingPage · ...
│           │   ├── auth/        LoginPage · RegisterPage
│           │   └── mop/         MopDashboardPage · MopRequestsPage
│           ├── shared/          Transversal (no atado a un dominio)
│           │   ├── components/  BudiLogo · LogoutButton · StatusBadge · ServiceTypeBadge
│           │   └── lib/         supabase/ (client · server · middleware)
│           ├── middleware.ts    Next.js middleware (debe vivir en src/ raíz)
│           └── test/            setup.ts (config de vitest)
│
├── packages/shared/            Tipos y utils compartidos (mobile + web)
│   └── src/                     types/ (domain·enums·geo·api) · utils/ · constants/
├── supabase/                   migrations/ · functions/ (Edge) · config.toml
└── package.json
```

**Convención de estructura (post-reestructuración 2026-06):**
- `app/` (móvil y web) = **solo routing**. En web, cada `page.tsx` es un shim:
  `export { default } from '@/features/<dominio>/<Page>'`.
- `features/<dominio>/` = lógica de un dominio, en `components/`, `hooks/`, `lib/`.
- `shared/` = transversal (design system, hooks globales). No depende de ningún feature.
- Alias `@/*` → raíz de cada app (ej. `@/shared/components/ui`, `@/features/tracking/...`).

### Design System Budi:
```typescript
// Colors
Primary: #2D5F8B (azul confianza)
Accent: #F5A25B (naranja calidez)
Success: #10B981
Error: #EF4444
Warning: #F59E0B

// Typography
Headings: Plus Jakarta Sans (Bold)
Body: Inter (Regular/Medium)

// Spacing
8pt grid: xs(4) s(8) m(16) l(24) xl(32) xxl(48)

// Touch Targets
Minimum: 50-56px para accesibilidad
```

---

## 🚨 PROBLEMAS CRÍTICOS A RESOLVER

### **Problema 1: Mapa de Tracking NO Visible** 🗺️

**Ubicación:** `app/(user)/index.tsx`

**Comportamiento Actual:**
- Cuando servicio tiene status "Asignado" o "En Camino"
- El usuario DEBERÍA ver un mapa con:
  - 📍 Pin rojo: Ubicación del usuario
  - 📍 Pin azul/naranja: Ubicación del operador (actualizándose en tiempo real)
  - 🛣️ Polyline: Ruta desde operador hasta usuario
  - ⏱️ ETA Card flotante: "Llegaremos en X minutos"
- Pero el mapa **NUNCA se ha visto funcionando**

**Datos Disponibles:**
- Tabla `operator_locations` con columnas:
  - `operator_id` (UUID)
  - `latitude` (REAL)
  - `longitude` (REAL)
  - `updated_at` (TIMESTAMP)
- Tabla `service_requests` con:
  - `pickup_latitude`, `pickup_longitude`
  - `operator_id` (cuando asignado)
  - `status` (enum)

**Lo que necesitamos:**
1. `react-native-maps` (probablemente ya instalado)
2. Suscripción Supabase Realtime a `operator_locations`
3. MapView con:
   - Marker usuario (pin rojo)
   - Marker operador (pin azul, se actualiza cada vez que operador envía ubicación)
   - Polyline (opcional, si hay ruta calculada)
4. Card flotante con ETA dinámico
5. Auto-center del mapa cuando operador se mueve

**Pseudocódigo esperado:**
```typescript
// En (user)/index.tsx cuando status === 'Asignado' | 'En Camino'

const [operatorLocation, setOperatorLocation] = useState(null);

useEffect(() => {
  if (activeRequest?.operator_id) {
    // Suscribirse a ubicación del operador
    const channel = supabase
      .channel('operator-tracking')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'operator_locations',
          filter: `operator_id=eq.${activeRequest.operator_id}`
        },
        (payload) => {
          setOperatorLocation({
            latitude: payload.new.latitude,
            longitude: payload.new.longitude
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }
}, [activeRequest?.operator_id]);

// Render
{(status === 'Asignado' || status === 'En Camino') && (
  <MapView
    style={{ flex: 1 }}
    initialRegion={{
      latitude: activeRequest.pickup_latitude,
      longitude: activeRequest.pickup_longitude,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    }}
  >
    {/* Usuario */}
    <Marker
      coordinate={{
        latitude: activeRequest.pickup_latitude,
        longitude: activeRequest.pickup_longitude
      }}
      pinColor="red"
    />
    
    {/* Operador */}
    {operatorLocation && (
      <Marker
        coordinate={operatorLocation}
        pinColor="#2D5F8B"
      />
    )}
  </MapView>
)}
```

---

### **Problema 2: Iconos de Servicios Básicos** 🎨

**Ubicación:** `app/(user)/request.tsx`

**Comportamiento Actual:**
- Selector de servicios usa emojis: 🚛 🔋 🛞 ⛽ 🔑
- No es profesional ni consistente con Budi DS

**Lo que necesitamos:**
Reemplazar emojis con Lucide Icons:
```typescript
import { Truck, Battery, CircleDot, Fuel, KeyRound } from 'lucide-react-native';

const SERVICES = [
  {
    id: 'grua',
    name: 'Grúa',
    icon: Truck, // ✅ Reemplaza 🚛
    description: 'Remolque de vehículo',
    price: 'Desde $60.00'
  },
  {
    id: 'bateria',
    name: 'Batería',
    icon: Battery, // ✅ Reemplaza 🔋
    description: 'Carga o reemplazo',
    price: 'Desde $25.00'
  },
  {
    id: 'neumatico',
    name: 'Neumático',
    icon: CircleDot, // ✅ Reemplaza 🛞
    description: 'Cambio de llanta',
    price: 'Desde $20.00'
  },
  {
    id: 'combustible',
    name: 'Combustible',
    icon: Fuel, // ✅ Reemplaza ⛽
    description: 'Entrega de gasolina',
    price: 'Desde $15.00'
  },
  {
    id: 'cerrajeria',
    name: 'Cerrajería',
    icon: KeyRound, // ✅ Reemplaza 🔑
    description: 'Apertura de vehículo',
    price: 'Desde $30.00'
  }
];

// En el render:
<Pressable
  style={[
    styles.serviceCard,
    selectedService === service.id && {
      borderColor: colors.accent[500],
      borderWidth: 2,
      backgroundColor: colors.accent[50]
    }
  ]}
  onPress={() => setSelectedService(service.id)}
>
  <View style={{
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.m
  }}>
    <service.icon size={36} color={colors.primary[600]} strokeWidth={2} />
  </View>
  <Text style={[typography.h3, { color: colors.accent[600] }]}>
    {service.name}
  </Text>
  <Text style={typography.bodySmall}>{service.description}</Text>
  <Text style={[typography.h3, { color: colors.accent[600] }]}>
    {service.price}
  </Text>
</Pressable>
```

---

## ✅ WORKFLOW PARA CLAUDE CODE

### **PASO 1: VERIFICACIÓN (OBLIGATORIO)**
Antes de tocar cualquier código:

```bash
# 1. Verificar estructura del proyecto
ls -la app/(user)/
ls -la app/(operator)/
ls -la components/ui/

# 2. Ver contenido actual de los archivos problemáticos
cat app/(user)/index.tsx | grep -A 30 "status === 'Asignado'"
cat app/(user)/request.tsx | grep -A 20 "SERVICES\|services"

# 3. Verificar dependencias
cat package.json | grep -E "react-native-maps|lucide-react-native"

# 4. Revisar estado actual de TypeScript
pnpm tsc --noEmit
```

**NO PROCEDER** hasta confirmar que entiendes el código actual.

---

### **PASO 2: FIX MAPA DE TRACKING**

**Archivo:** `app/(user)/index.tsx`

**Checklist:**
- [ ] Importar `react-native-maps` (MapView, Marker)
- [ ] Crear state `operatorLocation`
- [ ] Crear suscripción Realtime a `operator_locations`
- [ ] Renderizar MapView cuando status sea "Asignado" o "En Camino"
- [ ] Agregar Marker para usuario (pickup location, pin rojo)
- [ ] Agregar Marker para operador (operatorLocation, pin azul #2D5F8B)
- [ ] (Opcional) Agregar ETA Card flotante
- [ ] Probar con `pnpm start` y verificar en Expo Go

**Testing:**
1. Crear service request como usuario
2. Aceptar como operador (cambiar a status "Asignado")
3. Volver a pantalla usuario
4. **VERIFICAR:** ¿Se ve el mapa con ambos pins?
5. Como operador, mover ubicación GPS
6. **VERIFICAR:** ¿El pin azul se actualiza en tiempo real?

---

### **PASO 3: FIX ICONOS SERVICIOS**

**Archivo:** `app/(user)/request.tsx`

**Checklist:**
- [ ] Importar Lucide icons: `Truck, Battery, CircleDot, Fuel, KeyRound`
- [ ] Encontrar array/objeto `SERVICES` o similar
- [ ] Agregar propiedad `icon` a cada servicio
- [ ] En el render, reemplazar emoji por `<service.icon />`
- [ ] Aplicar estilos: size={36}, color={colors.primary[600]}, strokeWidth={2}
- [ ] Verificar que selección visual funcione (borde naranja cuando selected)

**Testing:**
1. Ir a pantalla de solicitud de servicio
2. **VERIFICAR:** ¿Los 5 servicios muestran iconos Lucide en vez de emojis?
3. Tocar cada servicio
4. **VERIFICAR:** ¿El borde naranja aparece al seleccionar?

---

### **PASO 4: VERIFICACIÓN FINAL**

```bash
# 1. Compilar TypeScript
pnpm tsc --noEmit

# 2. Verificar que no hay errores nuevos
# (Ignorar los 9 pre-existentes en hooks)

# 3. Listar archivos modificados
git status

# 4. Ver diff de cambios
git diff app/(user)/index.tsx
git diff app/(user)/request.tsx
```

**Criterios de éxito:**
- ✅ 0 nuevos errores TypeScript
- ✅ Mapa visible con tracking en tiempo real
- ✅ Iconos profesionales en 5 servicios
- ✅ Código limpio y comentado

---

## 📝 DOCUMENTACIÓN REQUERIDA

Al finalizar, actualiza:

### `tasks/completed.md`
```markdown
## 06 Feb 2026 - Fixes Críticos Pre-Production

### Mapa de Tracking Real-Time
- Implementado MapView en (user)/index.tsx
- Suscripción Realtime a operator_locations
- Markers para usuario (rojo) y operador (azul)
- Auto-actualización cuando operador se mueve
- Tested: ✅ Funciona en Expo Go

### Iconos Profesionales Servicios
- Reemplazados emojis por Lucide Icons en request.tsx
- Truck, Battery, CircleDot, Fuel, KeyRound
- Estilos consistentes con Budi DS
- Tested: ✅ Selección visual funciona
```

### `docs/lessons.md`
```markdown
## Lección: Importancia de Testing Temprano

**Problema:** Mapa de tracking nunca se probó hasta el final
**Impacto:** Feature crítica no funcionaba en producción
**Solución:** Implementar TDD básico:
1. Escribir test case antes de feature
2. Implementar feature
3. Verificar que test pasa
4. Deploy

**Lección:** Para features críticas como tracking en tiempo real,
SIEMPRE hacer testing manual con 2 dispositivos (usuario + operador)
antes de marcar como "completado".
```

---

## 🎯 RESULTADO ESPERADO

Al finalizar esta sesión:

1. **Usuario solicita grúa** → Ve mapa con pin rojo (su ubicación)
2. **Operador acepta** → Usuario ve pin azul aparecer (operador)
3. **Operador se mueve** → Pin azul se actualiza en tiempo real sin refresh
4. **Servicios** → Truck, Battery, CircleDot, Fuel, KeyRound icons profesionales

**ENTONCES** la app estará lista para:
- App Icons (iOS + Android)
- Splash screen
- Push notifications
- Production release 🚀

---

## ⚠️ RECORDATORIOS IMPORTANTES

1. **NO** eliminar código existente sin verificar su función
2. **SÍ** mantener compatibilidad con Expo SDK 54
3. **SÍ** seguir Budi Design System (colors, spacing, typography)
4. **SÍ** usar `useSafeAreaInsets()` en nuevos componentes
5. **NO** introducir nuevas dependencias sin consultar
6. **SÍ** documentar cualquier decisión técnica en comments

---

## 📞 CONTACTO

Si algo no está claro o necesitas aclaraciones:
- Pausar ejecución
- Reportar el bloqueador específico
- Pedir input antes de continuar

**¡Éxito en los fixes!** 🚀
