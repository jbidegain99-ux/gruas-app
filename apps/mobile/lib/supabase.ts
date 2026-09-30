import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { chunkedStore } from './secureChunks';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// La sesión (~2.1 KB) no cabe en un valor de SecureStore (~2 KB): se guarda
// en trozos. Ver lib/secureChunks.ts.
const { get: secureGet, set: secureSet, remove: secureRemove } = chunkedStore(SecureStore);

// Custom storage for Expo using SecureStore
const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.localStorage) {
        return localStorage.getItem(key);
      }
      return null;
    }
    return secureGet(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(key, value);
      }
      return;
    }
    await secureSet(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem(key);
      }
      return;
    }
    await secureRemove(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Renovación del token atada al ciclo de vida de la app (lo que pide Supabase
// para React Native): en segundo plano los temporizadores no corren, y al
// volver el token podía estar vencido sin que nadie lo renovara.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

// Distingue "cerró sesión la persona" de "la sesión se cayó sola" (token
// revocado o sin poder renovarse): en el segundo caso el layout avisa y manda
// al inicio; antes la app seguía en pantalla sin datos y sin decir nada.
let intentionalSignOut = false;

/** Cierra la sesión a propósito (salir, cuenta de otro rol, cuenta eliminada). */
export async function signOut(options?: { scope?: 'global' | 'local' | 'others' }): Promise<void> {
  intentionalSignOut = true;
  try {
    await supabase.auth.signOut(options);
  } catch {
    // Igual se considera cerrada localmente.
  }
}

/** true (una sola vez) si el último SIGNED_OUT lo pidió la persona. */
export function consumeIntentionalSignOut(): boolean {
  const was = intentionalSignOut;
  intentionalSignOut = false;
  return was;
}
