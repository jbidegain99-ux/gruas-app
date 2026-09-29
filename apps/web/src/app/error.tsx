'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Error de una página: el layout sigue en pie, solo se reemplaza el contenido.
// Se reporta a Sentry (sin DSN configurado es un no-op).
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="font-heading text-xl font-bold text-zinc-900 dark:text-white">Algo salió mal</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Ya nos llegó el aviso del error. Intenta de nuevo; si sigue pasando, escríbenos a soporte.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-budi-primary-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-budi-primary-600"
      >
        Intentar de nuevo
      </button>
      {error.digest && <p className="mt-6 text-xs text-zinc-400">Referencia: {error.digest}</p>}
    </div>
  );
}
