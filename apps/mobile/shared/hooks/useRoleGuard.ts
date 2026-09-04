import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import type { UserRole } from '@gruas-app/shared';
import { supabase } from '@/lib/supabase';

/**
 * Guard de rol para los grupos de rutas `(user)` y `(operator)`.
 *
 * Hasta ahora el reparto por rol ocurria SOLO al iniciar sesion: login.tsx
 * mandaba al operador a `(operator)` y a todos los demas a `(user)`. Alcanza
 * mientras se entre por ahi, pero expo-router resuelve rutas por su nombre —un
 * deep link, una notificacion o un `router.replace` mal puesto llegan al grupo
 * sin pasar por el login— y entonces un rol termina viendo las pantallas del
 * otro. La web ya cierra sus dos portales del lado del servidor (`/admin` en el
 * proxy, `/portal` en su layout); esto le da a la movil el equivalente.
 *
 * NO es la barrera de seguridad: esa es la RLS, que decide fila por fila y no
 * depende de que pantalla se abra. Un operador que llegara a `(user)` no leeria
 * datos ajenos —los veria vacios— pero veria una pantalla que no le toca, y eso
 * ya es un bug. Esto lo corta antes de que se pinte.
 */
export type EstadoGuard = 'verificando' | 'autorizado';

/**
 * A que grupo pertenece cada rol dentro de la app movil.
 *
 * `null` = ese rol no tiene app movil. ADMIN e INSURER trabajan desde la web
 * (`/admin` y `/portal`); no hay pantalla que darles aca.
 */
export function rutaDeInicio(rol: UserRole | null | undefined): '/(user)' | '/(operator)' | null {
  if (rol === 'OPERATOR') return '/(operator)';
  if (rol === 'USER') return '/(user)';
  return null;
}

export function useRoleGuard(rolEsperado: UserRole): EstadoGuard {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoGuard>('verificando');

  useEffect(() => {
    let vivo = true;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!vivo) return;

      if (!user) {
        router.replace('/(auth)/login');
        return;
      }

      const { data: perfil, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (!vivo) return;

      // Sin rol legible no se asume nada: al login. Es el caso raro (perfil
      // borrado, sesion vieja, red caida) y dejar pasar por defecto seria
      // exactamente el agujero que este guard viene a tapar.
      if (error || !perfil) {
        console.error('[guard] no se pudo leer el rol:', error?.message);
        router.replace('/(auth)/login');
        return;
      }

      const rol = perfil.role as UserRole;
      if (rol === rolEsperado) {
        setEstado('autorizado');
        return;
      }

      // Rol equivocado: a su propio grupo. Si no tiene ninguno (ADMIN/INSURER),
      // se cierra la sesion — un usuario autenticado sin destino en esta app se
      // quedaria rebotando contra el login sin entender por que.
      const destino = rutaDeInicio(rol);
      if (destino) {
        router.replace(destino);
      } else {
        await supabase.auth.signOut();
        if (vivo) router.replace('/(auth)/login');
      }
    })();

    return () => {
      vivo = false;
    };
  }, [rolEsperado, router]);

  return estado;
}
