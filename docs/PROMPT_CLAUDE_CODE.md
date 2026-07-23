# PROMPT PARA CLAUDE CODE - Fixes Críticos Pre-Production

## CONTEXTO COMPLETO
Lee primero el archivo CLAUDE_CODE_CONTEXT.md que está en este mismo directorio para entender TODO el proyecto.

## TU MISIÓN
Arreglar 2 problemas críticos antes de production:
1. **Mapa de tracking NO visible** en (user)/index.tsx
2. **Iconos profesionales** en (user)/request.tsx (reemplazar emojis)

---

## 🔍 PASO 1: VERIFICACIÓN OBLIGATORIA (15 min)

Antes de escribir una sola línea de código:

```bash
# 1. Ubicarte en el proyecto
cd /home/jose/gruas-app

# 2. Ver estructura actual
tree -L 3 -I 'node_modules|.git' app/

# 3. Verificar archivos problemáticos existen
ls -lh app/\(user\)/index.tsx
ls -lh app/\(user\)/request.tsx

# 4. Ver contenido relevante
echo "=== CONTENIDO (user)/index.tsx - Buscar mapa ==="
cat app/\(user\)/index.tsx | grep -A 50 "status === 'Asignado'\|status === 'En Camino'\|MapView\|react-native-maps"

echo -e "\n=== CONTENIDO (user)/request.tsx - Buscar servicios ==="
cat app/\(user\)/request.tsx | grep -A 30 "SERVICES\|services\|emoji\|🚛\|🔋"

# 5. Verificar dependencias instaladas
cat package.json | grep -E "react-native-maps|lucide-react-native|@react-native-community/geolocation"

# 6. Estado TypeScript
pnpm tsc --noEmit 2>&1 | tail -20
```

**REPORTA:** 
- ¿Existe MapView en index.tsx? ¿Qué hay actualmente?
- ¿Qué formato tienen los servicios en request.tsx?
- ¿Están instaladas las dependencias necesarias?
- ¿Cuántos errores TypeScript hay? (esperamos 9 pre-existentes en hooks)

**NO PROCEDER hasta reportar estos hallazgos.**

---

## 🗺️ PASO 2: FIX MAPA DE TRACKING (45 min)

### Análisis del Código Actual

**Archivo:** `app/(user)/index.tsx`

**Preguntas a responder antes de codear:**
1. ¿Existe un componente MapView ya renderizado?
2. ¿Hay suscripción a `operator_locations` en Realtime?
3. ¿Qué se renderiza cuando status es "Asignado" o "En Camino"?
4. ¿Existe state `operatorLocation`?

### Implementación Requerida

```typescript
// Importaciones necesarias
import MapView, { Marker } from 'react-native-maps';
import { supabase } from '@/lib/supabase';

// State management
const [operatorLocation, setOperatorLocation] = useState<{
  latitude: number;
  longitude: number;
} | null>(null);

// Suscripción Realtime (dentro de useEffect)
useEffect(() => {
  if (activeRequest?.operator_id && 
      (activeRequest.status === 'Asignado' || activeRequest.status === 'En Camino')) {
    
    console.log('[Tracking] Subscribing to operator:', activeRequest.operator_id);
    
    const channel = supabase
      .channel(`operator-tracking-${activeRequest.operator_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'operator_locations',
          filter: `operator_id=eq.${activeRequest.operator_id}`
        },
        (payload) => {
          console.log('[Tracking] Operator moved:', payload.new);
          setOperatorLocation({
            latitude: payload.new.latitude,
            longitude: payload.new.longitude
          });
        }
      )
      .subscribe((status) => {
        console.log('[Tracking] Subscription status:', status);
      });

    // Fetch ubicación inicial
    supabase
      .from('operator_locations')
      .select('latitude, longitude')
      .eq('operator_id', activeRequest.operator_id)
      .single()
      .then(({ data, error }) => {
        if (data) {
          console.log('[Tracking] Initial location:', data);
          setOperatorLocation({
            latitude: data.latitude,
            longitude: data.longitude
          });
        }
      });

    return () => {
      console.log('[Tracking] Unsubscribing');
      supabase.removeChannel(channel);
      setOperatorLocation(null);
    };
  }
}, [activeRequest?.operator_id, activeRequest?.status]);

// Renderizado condicional
{(activeRequest?.status === 'Asignado' || activeRequest?.status === 'En Camino') && (
  <View style={{ height: 400, marginVertical: spacing.l }}>
    <MapView
      style={{ flex: 1, borderRadius: 12 }}
      initialRegion={{
        latitude: activeRequest.pickup_latitude || 13.6929,
        longitude: activeRequest.pickup_longitude || -89.2182,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }}
      showsUserLocation={false}
      showsMyLocationButton={false}
      zoomEnabled={true}
      scrollEnabled={true}
    >
      {/* Pin Usuario (Pickup Location) */}
      <Marker
        coordinate={{
          latitude: activeRequest.pickup_latitude || 13.6929,
          longitude: activeRequest.pickup_longitude || -89.2182,
        }}
        title="Tu ubicación"
        pinColor="red"
      />

      {/* Pin Operador (Si existe ubicación) */}
      {operatorLocation && (
        <Marker
          coordinate={operatorLocation}
          title="Operador"
          description="Grúa en camino"
          pinColor="#2D5F8B"
        />
      )}
    </MapView>

    {/* Card flotante con ETA (opcional pero recomendado) */}
    {operatorLocation && (
      <Card
        style={{
          position: 'absolute',
          bottom: spacing.m,
          left: spacing.m,
          right: spacing.m,
          flexDirection: 'row',
          alignItems: 'center',
          padding: spacing.m,
        }}
        elevated
      >
        <MapPin size={24} color={colors.primary[600]} />
        <View style={{ marginLeft: spacing.m, flex: 1 }}>
          <Text style={typography.bodyMedium}>Operador en camino</Text>
          <Text style={[typography.bodySmall, { color: colors.neutral[600] }]}>
            {activeRequest.eta_minutes 
              ? `Llegará en ${activeRequest.eta_minutes} min` 
              : 'Calculando tiempo...'}
          </Text>
        </View>
      </Card>
    )}
  </View>
)}
```

### Testing Checklist

Después de implementar:

```bash
# 1. Compilar sin errores
pnpm tsc --noEmit

# 2. Iniciar dev server
pnpm start

# 3. En Expo Go:
# - Iniciar sesión como usuario
# - Crear solicitud de servicio
# - Cambiar a cuenta operador (o en otro dispositivo)
# - Aceptar la solicitud
# - Volver a cuenta usuario
# - VERIFICAR: ¿Se ve el mapa con 2 pins (rojo y azul)?

# 4. Mover ubicación del operador (puedes simular con Expo Go > Settings > Location)
# - VERIFICAR: ¿El pin azul se actualiza automáticamente?

# 5. Ver logs en terminal
# - Buscar: "[Tracking] Subscribing to operator"
# - Buscar: "[Tracking] Operator moved"
```

**Criterios de éxito:**
- ✅ Mapa visible en pantalla usuario cuando status "Asignado" o "En Camino"
- ✅ Pin rojo aparece en pickup location
- ✅ Pin azul aparece cuando hay ubicación de operador
- ✅ Pin azul se actualiza en tiempo real cuando operador se mueve
- ✅ No hay crashes ni errores en consola
- ✅ 0 nuevos errores TypeScript

---

## 🎨 PASO 3: FIX ICONOS SERVICIOS (30 min)

### Análisis del Código Actual

**Archivo:** `app/(user)/request.tsx`

**Preguntas a responder:**
1. ¿Cómo están definidos los servicios? (array, objeto, constante)
2. ¿Qué formato tienen? ¿Hay campo `icon`?
3. ¿Cómo se renderizan actualmente? (FlatList, map, etc.)
4. ¿Ya está importado `lucide-react-native`?

### Implementación Requerida

```typescript
// Importaciones necesarias
import { Truck, Battery, CircleDot, Fuel, KeyRound } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

// Definición de servicios con iconos
const SERVICES: Array<{
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
  basePrice: number;
}> = [
  {
    id: 'grua',
    name: 'Grúa',
    icon: Truck,
    description: 'Remolque de vehículo',
    basePrice: 60,
  },
  {
    id: 'bateria',
    name: 'Batería',
    icon: Battery,
    description: 'Carga o reemplazo',
    basePrice: 25,
  },
  {
    id: 'neumatico',
    name: 'Neumático',
    icon: CircleDot,
    description: 'Cambio de llanta',
    basePrice: 20,
  },
  {
    id: 'combustible',
    name: 'Combustible',
    icon: Fuel,
    description: 'Entrega de gasolina',
    basePrice: 15,
  },
  {
    id: 'cerrajeria',
    name: 'Cerrajería',
    icon: KeyRound,
    description: 'Apertura de vehículo',
    basePrice: 30,
  },
];

// Renderizado de cada servicio
{SERVICES.map((service) => (
  <Pressable
    key={service.id}
    style={[
      styles.serviceCard,
      selectedService === service.id && {
        borderColor: colors.accent[500],
        borderWidth: 2,
        backgroundColor: colors.accent[50],
      }
    ]}
    onPress={() => setSelectedService(service.id)}
  >
    {/* Contenedor circular del icono */}
    <View
      style={{
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: selectedService === service.id 
          ? colors.accent[100] 
          : colors.primary[100],
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.m,
      }}
    >
      <service.icon 
        size={36} 
        color={selectedService === service.id 
          ? colors.accent[600] 
          : colors.primary[600]
        } 
        strokeWidth={2} 
      />
    </View>

    {/* Nombre del servicio */}
    <Text style={[typography.h3, { color: colors.accent[600], textAlign: 'center' }]}>
      {service.name}
    </Text>

    {/* Descripción */}
    <Text style={[typography.bodySmall, { textAlign: 'center', marginTop: spacing.xs }]}>
      {service.description}
    </Text>

    {/* Precio */}
    <Text style={[typography.h3, { color: colors.accent[600], marginTop: spacing.s }]}>
      ${service.basePrice.toFixed(2)}
    </Text>
  </Pressable>
))}
```

### Testing Checklist

```bash
# 1. Compilar
pnpm tsc --noEmit

# 2. Iniciar app
pnpm start

# 3. En Expo Go:
# - Ir a pantalla de solicitud de servicio
# - VERIFICAR: ¿Los 5 servicios muestran iconos Lucide?
# - Tocar "Grúa": ¿Ves el ícono Truck?
# - Tocar "Batería": ¿Ves el ícono Battery?
# - Tocar "Neumático": ¿Ves el ícono CircleDot?
# - Tocar "Combustible": ¿Ves el ícono Fuel?
# - Tocar "Cerrajería": ¿Ves el ícono KeyRound?

# 4. Interacción:
# - Tocar cada servicio
# - VERIFICAR: ¿El borde cambia a naranja (#F5A25B)?
# - VERIFICAR: ¿El fondo del círculo cambia a naranja claro?
```

**Criterios de éxito:**
- ✅ 5 servicios con iconos Lucide profesionales
- ✅ No hay emojis visibles
- ✅ Selección visual funciona (borde naranja, fondo naranja claro)
- ✅ Iconos cambian de color al seleccionar
- ✅ 0 nuevos errores TypeScript

---

## 📝 PASO 4: DOCUMENTACIÓN (10 min)

### Actualizar `tasks/completed.md`

```markdown
## 06 Feb 2026 - Fixes Críticos Pre-Production

### ✅ Mapa de Tracking Real-Time
**Problema:** Mapa nunca se mostraba cuando servicio estaba asignado/en camino
**Solución:** 
- Implementado MapView en (user)/index.tsx
- Suscripción Supabase Realtime a `operator_locations`
- Markers: Usuario (rojo) + Operador (azul #2D5F8B)
- Card flotante con ETA
- Auto-actualización cuando operador envía ubicación
**Archivos modificados:** app/(user)/index.tsx
**Testing:** ✅ Probado con 2 cuentas (usuario + operador) en Expo Go
**Resultado:** Usuario ve grúa acercándose en tiempo real

### ✅ Iconos Profesionales en Servicios
**Problema:** Selector de servicios usaba emojis (🚛🔋🛞⛽🔑)
**Solución:**
- Reemplazados por Lucide Icons: Truck, Battery, CircleDot, Fuel, KeyRound
- Estilos consistentes con Budi Design System
- Estados: Default (azul) + Selected (naranja)
**Archivos modificados:** app/(user)/request.tsx
**Testing:** ✅ Verificada selección visual y cambio de colores
**Resultado:** Iconografía profesional alineada con branding Budi
```

### Actualizar `docs/lessons.md`

```markdown
## Lección: Importance of Real-Time Feature Testing

**Contexto:** Mapa de tracking se marcó como "implementado" en Phase 2, pero nunca se probó realmente hasta pre-production.

**Problema:** Feature crítica no funcionaba porque:
1. MapView probablemente existía en código pero no se renderizaba
2. Suscripción Realtime no estaba conectada correctamente
3. No se hizo testing con 2 dispositivos (usuario + operador)

**Impacto:** 
- Feature crítica no funcional hasta último momento
- Hubiera bloqueado production launch

**Solución Aplicada:**
- TDD básico para features críticas:
  1. Definir test case ANTES de implementar
  2. Implementar feature
  3. Verificar que test pasa
  4. Marcar como "completado"

**Regla Nueva:**
Para features de **tiempo real** (chat, tracking, notifications):
- SIEMPRE probar con 2+ dispositivos/cuentas
- VERIFICAR actualización automática
- DOCUMENTAR casos de prueba en tasks/testing.md

**Aprendizaje:**
"Código que compila ≠ Funcionalidad que funciona"
Especialmente en features multi-usuario y tiempo real.
```

---

## ✅ PASO 5: VERIFICACIÓN FINAL (10 min)

```bash
# 1. Ver archivos modificados
git status

# 2. Ver diff completo
git diff app/(user)/index.tsx
git diff app/(user)/request.tsx

# 3. Compilación limpia
pnpm tsc --noEmit

# 4. Contar errores TypeScript
pnpm tsc --noEmit 2>&1 | grep "error TS" | wc -l
# Esperamos: 9 (los pre-existentes en hooks)

# 5. Testing manual final
pnpm start
# - Crear solicitud → Aceptar → Ver mapa ✅
# - Ver 5 iconos Lucide ✅
```

---

## 🎯 CRITERIOS DE COMPLETADO

**Marca como completado SOLO si:**

- [x] Mapa visible cuando status "Asignado" o "En Camino"
- [x] 2 pins (usuario rojo, operador azul) en mapa
- [x] Pin operador se actualiza en tiempo real al moverse
- [x] 5 servicios muestran iconos Lucide (no emojis)
- [x] Selección de servicio cambia a naranja
- [x] 0 nuevos errores TypeScript (mantenemos los 9 pre-existentes)
- [x] Código documentado con comments claros
- [x] `tasks/completed.md` actualizado
- [x] `docs/lessons.md` actualizado
- [x] Testing manual exitoso reportado

---

## 🚨 SI ALGO SALE MAL

**Si encuentras problemas:**

1. **Dependencia faltante:**
   ```bash
   # Instalar react-native-maps si no está
   pnpm add react-native-maps
   
   # Verificar lucide-react-native
   pnpm add lucide-react-native
   ```

2. **Error de importación MapView:**
   - Verificar que `app.json` tiene configuración de Google Maps API key
   - Revisar `expo-location` está instalado

3. **Suscripción Realtime no funciona:**
   - Verificar RLS policies en `operator_locations` permiten SELECT
   - Revisar que operador está enviando ubicación (`operator/active.tsx`)
   - Usar `console.log` para debug

4. **TypeScript errors en tipos:**
   - Agregar `any` temporal si es necesario
   - Documentar en comment por qué se usa `any`

**REPORTA cualquier bloqueador antes de continuar.**

---

## 📞 OUTPUT ESPERADO

Al terminar, deberías reportar:

```
✅ COMPLETADO - Fixes Críticos Pre-Production

Archivos modificados:
- app/(user)/index.tsx (+78 lines, -5 lines)
- app/(user)/request.tsx (+42 lines, -18 lines)

Features implementadas:
1. ✅ Mapa tracking real-time
   - MapView con 2 markers
   - Suscripción Realtime funcional
   - ETA card flotante
   
2. ✅ Iconos profesionales servicios
   - 5 Lucide icons: Truck, Battery, CircleDot, Fuel, KeyRound
   - Estados visual selección (naranja)

Testing:
✅ Probado con 2 cuentas en Expo Go
✅ Pin operador se actualiza en tiempo real
✅ 5 iconos visibles y seleccionables
✅ 0 nuevos errores TypeScript (9 pre-existentes mantenidos)

Documentación:
✅ tasks/completed.md actualizado
✅ docs/lessons.md actualizado

La app está lista para:
- App Icons
- Splash screen
- Production release 🚀
```

---

**¡Éxito en los fixes!** 🔧
