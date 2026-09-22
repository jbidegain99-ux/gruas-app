import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';
import { useBudiFonts } from '@/shared/hooks/useBudiFonts';
import { loadDropoffCatalog } from '@/features/catalog/lib/loadDropoffCatalog';
// Import con efecto secundario: registra la tarea de ubicación en segundo plano
// (`TaskManager.defineTask`) al arrancar, antes de que el sistema pueda
// entregar posiciones. Debe ocurrir en el arranque, no dentro de una pantalla.
import '@/features/tracking/lib/backgroundLocationTask';

// Initialize Sentry early. With no DSN configured (typical for dev),
// the SDK becomes a no-op — safe to keep in the codebase even before
// the production project is set up.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // Send 100% of errors; trace sampling stays modest to keep the
    // free tier reasonable. Tune via EXPO_PUBLIC_SENTRY_TRACES_RATE
    // if needed.
    tracesSampleRate: Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_RATE ?? 0.1),
    enableAutoSessionTracking: true,
    // PII off by default; the app handles location + chat which can
    // both be sensitive. Flip when we know what we want to capture.
    sendDefaultPii: false,
  });
}

SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [fontsLoaded, fontError] = useBudiFonts();

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Catalogo de servicios: que tipos trasladan el vehiculo y por lo tanto tienen
  // destino. Se carga una vez al arrancar, antes de que monte ninguna pantalla,
  // para que `requiresDropoff()` responda sincronicamente en historiales y mapas.
  // Si falla, el helper cae a su respaldo.
  useEffect(() => {
    loadDropoffCatalog();
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(user)" options={{ headerShown: false }} />
        <Stack.Screen name="(operator)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default Sentry.wrap(RootLayout);
