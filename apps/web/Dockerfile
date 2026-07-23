## Build context MUST be the monorepo root (not apps/web), so we can copy
## pnpm-lock.yaml and the @gruas-app/shared workspace package.
##
##   docker build -f apps/web/Dockerfile -t budi-web .

# ---------- deps: install workspace dependencies ----------
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

# Copy only manifests first so this layer caches across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile --filter web... --filter @gruas-app/shared

# ---------- builder: compile Next.js standalone bundle ----------
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY . .

# Build-time secrets (all optional). NEXT_PUBLIC_* get baked into the
# bundle; SENTRY_* are only used by withSentryConfig at build time to
# upload sourcemaps and aren't shipped to the client.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_TRACES_RATE
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT

ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_TRACES_RATE=$NEXT_PUBLIC_SENTRY_TRACES_RATE \
    CI=true

# SENTRY_AUTH_TOKEN is a real secret (source-map upload). Pass it INLINE to the
# build RUN instead of as an ENV: a persistent ENV is written into the builder
# image's config/history, and `cache-to: type=gha,mode=max` in CI exports the
# builder stage to the shared GHA cache — anyone with repo read access could
# then recover the token. Inline RUN assignments reference the ARG ($VAR) and
# are not expanded into `docker history`, so the token never lands in a layer.
RUN SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    pnpm --filter web build

# ---------- runner: minimal runtime image ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as non-root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Next standalone output layout (monorepo-aware):
#   /repo/apps/web/.next/standalone/  -> bundled server + minimal deps
#   /repo/apps/web/.next/standalone/apps/web/server.js
#   /repo/apps/web/.next/static/      -> static assets (copied separately)
#   /repo/apps/web/public/            -> public assets (copied separately)
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
