// Client-side Sentry init. Next.js 15+ loads this once per browser
// session. Bundled into the client chunk; uses only NEXT_PUBLIC_*
// variables (the regular SENTRY_AUTH_TOKEN etc. are server-only).

import * as Sentry from '@sentry/nextjs';
import { scrubBreadcrumbData, scrubEvent } from '@/shared/lib/sentry-scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_RATE ?? 0.1),
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    // Tokens de invitación/sesión viajan en la URL: se tapan antes de salir.
    beforeSend: scrubEvent,
    beforeBreadcrumb: (b) => {
      scrubBreadcrumbData(b.data);
      return b;
    },
    // Replay disabled — extra bundle weight; turn on when we know we want it.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

// Required so Next can stitch client-side navigations into the same
// transaction the server started. Safe to call even when Sentry isn't
// initialized (becomes a no-op).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
