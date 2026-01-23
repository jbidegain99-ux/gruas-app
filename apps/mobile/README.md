# Gruas App Mobile

Aplicación móvil para Gruas App El Salvador, construida con Expo SDK 52 y React Native.

## Requisitos

- Node.js 18+
- pnpm (administrador de paquetes del monorepo)
- Expo Go app (para desarrollo en dispositivo físico)

## Desarrollo

### Iniciar el servidor de desarrollo

```bash
# Desde la raíz del monorepo
pnpm dev:mobile

# O desde apps/mobile
pnpm start
```

### Comandos disponibles

```bash
pnpm start      # Inicia Expo bundler
pnpm android    # Abre en Android
pnpm ios        # Abre en iOS
pnpm lint       # Ejecuta ESLint
pnpm typecheck  # Ejecuta TypeScript check
```

> **Nota:** Web está deshabilitado. Esta app está diseñada para dispositivos móviles (iOS/Android) únicamente. Para el portal web, usar `apps/web`.

## Versiones de Dependencias (Expo SDK 52)

Las versiones de las siguientes dependencias DEBEN mantenerse alineadas con Expo SDK 52:

| Paquete | Versión Requerida | Notas |
|---------|-------------------|-------|
| `react-native` | 0.76.9 | Core de React Native |
| `react-native-web` | ~0.19.13 | **NO usar 0.21+** (incompatible) |
| `@expo/metro-runtime` | ~4.0.1 | **NO usar 6.x** (incompatible) |

### Importante: No actualizar manualmente

Siempre usar el comando de Expo para actualizar dependencias:

```bash
npx expo install <paquete>
```

Esto asegura versiones compatibles con el SDK actual.

### Error conocido: "Failed to set indexed property on CSSStyleDeclaration"

**Causas posibles:**

1. **Versión incorrecta de react-native-web:** Versión 0.21+ es incompatible con Expo SDK 52.
   - **Solución:** Asegurar que `react-native-web` sea versión `~0.19.13`.

2. **Style arrays en Link asChild:** Cuando usas `<Link asChild>` con un child que tiene `style={[...]}` (array), el estilo se forwardea al DOM sin flatten.
   - **Solución:** Siempre usar `StyleSheet.flatten()` en estilos que puedan llegar a DOM:

```tsx
// ❌ MAL - causa crash en web
<Link href="/page" asChild>
  <TouchableOpacity style={[styles.a, styles.b]}>
    ...
  </TouchableOpacity>
</Link>

// ✅ BIEN - flatten antes de pasar
const flatStyle = StyleSheet.flatten([styles.a, styles.b]);
<Link href="/page" asChild>
  <TouchableOpacity style={flatStyle}>
    ...
  </TouchableOpacity>
</Link>
```

**Regla general:** Si usas `Slot`, `asChild`, o `Link asChild` en web, SIEMPRE flatten los style arrays.

## Estructura

```
apps/mobile/
├── app/                    # Rutas de Expo Router
│   ├── (auth)/            # Pantallas de autenticación
│   ├── (operator)/        # Pantallas de operador
│   ├── (user)/            # Pantallas de usuario
│   └── index.tsx          # Pantalla de bienvenida
├── lib/                   # Utilidades (supabase client)
└── package.json
```

## Troubleshooting

### El bundler web muestra errores de estilos

1. Verificar versiones: `pnpm ls react-native-web @expo/metro-runtime`
2. Si las versiones son incorrectas, correr `pnpm install` desde la raíz

### Expo Doctor reporta incompatibilidades

```bash
npx expo-doctor
npx expo install --check
```

### Limpiar cache de Metro

```bash
npx expo start --clear
```
