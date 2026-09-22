import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Self-contained output for Docker/VPS deploys. Includes only the deps
  // actually traced by Next, with @gruas-app/shared bundled via the
  // monorepo-aware tracing root below.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

// Only wrap with Sentry's build-time integration when both the public
// DSN and a server-side auth token are present. Skips source-map
// uploads (and the network call they imply) during local dev / CI
// without secrets configured.
const sentryEnabled =
  Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) &&
  Boolean(process.env.SENTRY_AUTH_TOKEN);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Silence the Sentry CLI plugin locally; let CI log everything.
      silent: !process.env.CI,
      // Upload source maps to Sentry then strip them from the bundle —
      // gives us nice stack traces in Sentry without leaking the maps
      // to anyone hitting the CDN.
      sourcemaps: {
        deleteSourcemapsAfterUpload: true,
      },
      disableLogger: true,
    })
  : nextConfig;
