// Limpieza de lo que se manda a Sentry (backlog LAN-03, Decreto 144).
//
// Hay secretos que viajan en la URL: el token de invitación a un portal
// (/invitacion?token=...), la sesión del enlace del correo (#access_token=...)
// y el `code` del flujo PKCE. Sentry guarda la URL en cada evento y en las
// migas de navegación, así que se tapan antes de salir del navegador o del
// servidor. `sendDefaultPii: false` no cubre esto: no toca la URL.

const SECRET_PARAMS = /([?&#](?:token|access_token|refresh_token|code|provider_token|token_hash)=)[^&#\s]*/gi;

/** La URL con el valor de cada parámetro secreto reemplazado por [oculto]. */
export function scrubUrl(url: string): string {
  return url.replace(SECRET_PARAMS, '$1[oculto]');
}

type EventLike = {
  request?: { url?: string; query_string?: unknown; headers?: Record<string, string>; cookies?: unknown };
  breadcrumbs?: { data?: Record<string, unknown> }[];
};

/** Para `beforeSend`: tapa URLs, query y cabeceras con credenciales. */
export function scrubEvent<T extends EventLike>(event: T): T {
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = scrubUrl(`?${event.request.query_string}`).slice(1);
    } else if (event.request.query_string) {
      event.request.query_string = '[oculto]';
    }
    if (event.request.headers) {
      for (const h of Object.keys(event.request.headers)) {
        if (/^(authorization|cookie|apikey)$/i.test(h)) event.request.headers[h] = '[oculto]';
      }
    }
    if (event.request.cookies) event.request.cookies = '[oculto]';
  }
  for (const b of event.breadcrumbs ?? []) scrubBreadcrumbData(b.data);
  return event;
}

/** Para `beforeBreadcrumb`: navegación (from/to) y fetch/xhr (url). */
export function scrubBreadcrumbData(data?: Record<string, unknown>): void {
  if (!data) return;
  for (const k of ['url', 'from', 'to']) {
    if (typeof data[k] === 'string') data[k] = scrubUrl(data[k] as string);
  }
}
