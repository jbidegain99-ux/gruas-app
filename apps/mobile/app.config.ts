import type { ConfigContext, ExpoConfig } from 'expo/config';

// Configuración de la app móvil Budi. Reemplaza al app.json estático para
// poder variar por entorno sin tocar código:
//
//   APP_VARIANT=development  → "Budi (dev)",    com.budisv.app.dev
//   APP_VARIANT=preview      → "Budi (prueba)", com.budisv.app.preview
//   (sin variable)           → "Budi",          com.budisv.app   ← tiendas
//
// Con identificadores distintos, las tres versiones conviven en el mismo
// teléfono y un build de prueba nunca pisa la app publicada. eas.json fija la
// variante de cada perfil.
//
// OJO: `com.budisv.app` es PERMANENTE una vez publicada en Google Play o en la
// App Store. No cambiarlo después del primer envío.

const VARIANT = process.env.APP_VARIANT ?? 'production';
const IS_DEV = VARIANT === 'development';
const IS_PREVIEW = VARIANT === 'preview';

const BUNDLE_ID = IS_DEV ? 'com.budisv.app.dev' : IS_PREVIEW ? 'com.budisv.app.preview' : 'com.budisv.app';
const APP_NAME = IS_DEV ? 'Budi (dev)' : IS_PREVIEW ? 'Budi (prueba)' : 'Budi';

// La llave de Google Maps NO va en el repo: se carga como variable de entorno
// de EAS (o en .env para builds locales) y se restringe en Google Cloud al
// paquete y a la firma de la app. Sin llave, el mapa nativo no carga pero el
// resto de la app funciona.
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

// Lo escribe `eas init`. Hace falta para push (getExpoPushTokenAsync) y para
// las actualizaciones por aire.
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID;

const BRAND_BLUE = '#2D5F8B';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAME,
  slug: 'budi',
  owner: process.env.EAS_OWNER,
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  scheme: 'budi',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },

  // Actualizaciones por aire: los cambios de JavaScript se publican con
  // `eas update` sin pasar por la revisión de las tiendas. Un cambio nativo
  // (permisos, librerías con código nativo) sube la versión y exige build nuevo:
  // `runtimeVersion: appVersion` impide que una actualización llegue a un
  // binario incompatible.
  runtimeVersion: { policy: 'appVersion' },
  updates: EAS_PROJECT_ID ? { url: `https://u.expo.dev/${EAS_PROJECT_ID}` } : undefined,

  ios: {
    supportsTablet: false,
    bundleIdentifier: BUNDLE_ID,
    config: { googleMapsApiKey: GOOGLE_MAPS_API_KEY },
    infoPlist: {
      // Apple revisa estos textos: tienen que decir para qué se usa cada permiso.
      NSLocationWhenInUseUsageDescription:
        'Budi usa tu ubicación para saber dónde necesitas asistencia y, si eres socio operador, para mostrarte las solicitudes cercanas.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Si eres socio operador, Budi usa tu ubicación mientras atiendes un servicio, aunque la app esté en segundo plano, para que el usuario vea llegar tu grúa.',
      NSLocationAlwaysUsageDescription:
        'Si eres socio operador, Budi usa tu ubicación mientras atiendes un servicio, aunque la app esté en segundo plano, para que el usuario vea llegar tu grúa.',
      NSCameraUsageDescription:
        'Budi usa la cámara para fotografiar tu vehículo al pedir asistencia y, si eres socio operador, tus documentos de verificación.',
      NSPhotoLibraryUsageDescription:
        'Budi accede a tus fotos para adjuntar la del vehículo o tus documentos de verificación.',
      UIBackgroundModes: ['location'],
      // Sin cifrado propio (solo HTTPS del sistema): evita la pregunta de
      // exportación en cada envío a TestFlight.
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: BRAND_BLUE,
    },
    config: { googleMaps: { apiKey: GOOGLE_MAPS_API_KEY } },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
    ],
  },

  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/favicon.png',
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Si eres socio operador, Budi usa tu ubicación mientras atiendes un servicio, aunque la app esté en segundo plano, para que el usuario vea llegar tu grúa.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Budi accede a tus fotos para adjuntar la del vehículo o tus documentos de verificación.',
        cameraPermission: 'Budi usa la cámara para fotografiar tu vehículo o tus documentos de verificación.',
      },
    ],
    [
      'expo-notifications',
      {
        // Blanco sobre transparente: Android lo tiñe con `color`.
        icon: './assets/notification-icon.png',
        color: BRAND_BLUE,
        sounds: [],
      },
    ],
    'expo-font',
    // organización y proyecto de Sentry: variables SENTRY_ORG / SENTRY_PROJECT
    // (y SENTRY_AUTH_TOKEN como secreto de EAS) para subir los source maps.
    '@sentry/react-native',
  ],

  experiments: {
    typedRoutes: true,
  },

  extra: {
    appVariant: VARIANT,
    eas: { projectId: EAS_PROJECT_ID },
  },
});
