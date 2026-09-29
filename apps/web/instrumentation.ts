// Server + edge runtime Sentry initialization. Next.js calls register()
// once on cold start of each runtime. Without NEXT_PUBLIC_SENTRY_DSN
// the SDK isn't initialized, which keeps dev/CI free of network noise.

import * as Sentry from '@sentry/nextjs';
import { scrubBreadcrumbData, scrubEvent } from '@/shared/lib/sentry-scrub';

export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  const common = {
    dsn,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE ?? 0.1),
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV,
    // PII off — service handles GPS + chat which can be sensitive.
    sendDefaultPii: false,
    // Tokens de invitación/sesión viajan en la URL: se tapan antes de salir.
    beforeSend: scrubEvent,
    beforeBreadcrumb: (b: Sentry.Breadcrumb) => {
      scrubBreadcrumbData(b.data);
      return b;
    },
  };

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init(common);
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(common);
  }
}

// Capture errors thrown by route handlers and server actions.
export const onRequestError = Sentry.captureRequestError;
