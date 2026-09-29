'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Último recurso: un error que rompe el layout raíz. Sin este archivo los
// errores de render del App Router no llegan a Sentry (backlog LAN-03).
// Reemplaza al layout, así que lleva su propio <html> y estilos en línea.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#fafafa', color: '#18181b', margin: 0 }}>
        <main style={{ maxWidth: 480, margin: '15vh auto', padding: '0 16px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Algo salió mal</h1>
          <p style={{ color: '#52525b', marginBottom: 24 }}>
            Ya nos llegó el aviso del error. Intenta de nuevo; si sigue pasando, escríbenos a soporte.
          </p>
          <button
            onClick={reset}
            style={{ background: '#2D5F8B', color: '#fff', border: 0, borderRadius: 8, padding: '10px 20px', fontSize: 15, cursor: 'pointer' }}
          >
            Intentar de nuevo
          </button>
          {error.digest && <p style={{ color: '#a1a1aa', fontSize: 12, marginTop: 24 }}>Referencia: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
