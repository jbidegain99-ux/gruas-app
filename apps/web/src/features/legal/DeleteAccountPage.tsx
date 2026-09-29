'use client';

// Página pública para eliminar la cuenta (migr. 00101). Google Play exige una
// URL web donde se pueda pedir la baja sin la app instalada; Apple exige la
// opción dentro de la app (esa está en Perfil). Las dos usan la misma Edge
// Function `delete-account`.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/shared/lib/supabase/client';
import { BudiLogo } from '@/shared/components/BudiLogo';

const PALABRA = 'ELIMINAR';

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'sin-sesion' }
  | { tipo: 'gestion' } // admin, aseguradora o MOPT: las da de baja Budi
  | { tipo: 'lista'; nombre: string; email: string | null }
  | { tipo: 'eliminada' };

export default function DeleteAccountPage() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [typed, setTyped] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  // Decreto 144, derecho de acceso (migr. 00139): una copia antes de borrar.
  const descargarDatos = async () => {
    setExportando(true);
    const { data, error: e } = await createClient().rpc('export_my_data');
    setExportando(false);
    if (e || !data) return setError('No se pudo preparar tu copia de datos. Intenta de nuevo.');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mis-datos-budi-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return setEstado({ tipo: 'sin-sesion' });
      const { data: perfil } = await supabase.from('profiles').select('full_name, email, role').eq('id', user.id).single();
      if (perfil?.role !== 'USER' && perfil?.role !== 'OPERATOR') return setEstado({ tipo: 'gestion' });
      setEstado({ tipo: 'lista', nombre: perfil.full_name, email: perfil.email });
    })();
  }, []);

  const eliminar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (fnError || !(data as { success?: boolean } | null)?.success) {
      let message = 'No se pudo eliminar la cuenta. Intenta de nuevo en unos minutos.';
      const ctx = (fnError as { context?: Response } | null)?.context;
      if (ctx && typeof ctx.json === 'function') {
        try {
          const body = await ctx.json();
          if (body?.error) message = body.error;
        } catch {
          // cuerpo no JSON: queda el mensaje genérico
        }
      }
      setError(message);
      setEnviando(false);
      return;
    }
    // El servidor ya borró la sesión: `scope: 'local'` solo limpia la guardada
    // acá. Un signOut normal le pide al servidor cerrarla y responde 500.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    setEstado({ tipo: 'eliminada' });
  };

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="inline-block">
          <BudiLogo />
        </Link>
        <h1 className="mt-6 text-2xl font-bold text-zinc-900 dark:text-white">Eliminar tu cuenta de Budi</h1>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          <p>Al eliminar tu cuenta:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Se borran tu nombre, teléfono, correo, DUI, vehículos, fotos y documentos.</li>
            <li>No vas a poder volver a entrar con esa cuenta.</li>
            <li>
              Los servicios que ya se prestaron quedan registrados <strong>sin tus datos</strong>, porque son
              registros contables.
            </li>
          </ul>
          <p>
            También puedes hacerlo desde la app: <strong>Perfil → Eliminar mi cuenta</strong>. Más detalle en el{' '}
            <Link href="/privacidad" className="text-budi-primary-600 underline dark:text-budi-primary-400">
              aviso de privacidad
            </Link>
            .
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          {estado.tipo === 'cargando' && <p className="text-sm text-zinc-500">Cargando…</p>}

          {estado.tipo === 'sin-sesion' && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Para confirmar que la cuenta es tuya, primero inicia sesión con tu correo y contraseña.
              </p>
              <Link
                href="/login?redirect=/eliminar-cuenta"
                className="inline-block rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600"
              >
                Iniciar sesión
              </Link>
            </div>
          )}

          {estado.tipo === 'gestion' && (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Esta cuenta es de gestión (administración, aseguradora o programa MOPT). Su baja la hace Budi: pídela a
              tu contacto de soporte.
            </p>
          )}

          {estado.tipo === 'lista' && (
            <div className="mb-6 border-b border-zinc-200 pb-6 dark:border-zinc-800">
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Antes de eliminarla (o cuando quieras) puedes descargar una copia de todo lo que Budi guarda de ti.
              </p>
              <button
                type="button"
                onClick={descargarDatos}
                disabled={exportando}
                className="mt-3 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {exportando ? 'Preparando…' : 'Descargar mis datos'}
              </button>
            </div>
          )}

          {estado.tipo === 'lista' && (
            <form onSubmit={eliminar} className="space-y-4">
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Vas a eliminar la cuenta de <strong>{estado.nombre}</strong>
                {estado.email ? ` (${estado.email})` : ''}. Esto no se puede deshacer.
              </p>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Para confirmar, escribe {PALABRA}
                <input
                  id="confirm-delete"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-red-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </label>
              {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={typed.trim().toUpperCase() !== PALABRA || enviando}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
              >
                {enviando ? 'Eliminando…' : 'Eliminar mi cuenta'}
              </button>
            </form>
          )}

          {estado.tipo === 'eliminada' && (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Tu cuenta fue eliminada. Gracias por haber usado Budi.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
