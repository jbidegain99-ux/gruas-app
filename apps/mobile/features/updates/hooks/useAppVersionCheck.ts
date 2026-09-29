import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';
import { normalizeVersion, parseVersionCheck, type VersionCheck } from '@/lib/appVersion';

/**
 * Pregunta a la base si esta versión de la app sigue siendo aceptable
 * (migr. 00118). Se consulta al arrancar y cada vez que la app vuelve al
 * frente: un servicio puede durar horas y la versión mínima puede subir en
 * medio. Sin sesión (la RPC es pública) y fallando abierta.
 */
export function useAppVersionCheck(): VersionCheck | null {
  const [check, setCheck] = useState<VersionCheck | null>(null);

  useEffect(() => {
    const version = normalizeVersion(Constants.expoConfig?.version);
    if (!version || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return;

    let alive = true;
    const run = async () => {
      const { data, error } = await supabase.rpc('app_version_check', {
        p_platform: Platform.OS,
        p_version: version,
      });
      if (alive && !error) setCheck(parseVersionCheck(data));
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return check;
}
