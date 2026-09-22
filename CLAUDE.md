# CLAUDE.md

Guía para trabajar en este repo. Servicio de grúas (El Salvador), marca **Budi**.
Monorepo **pnpm** con app móvil (Expo), web (Next.js) y backend (Supabase).

## Comandos (desde la raíz)

```bash
pnpm dev:web          # Next.js dev server
pnpm dev:mobile       # Expo (start)
pnpm typecheck        # tsc --noEmit en todos los paquetes (pnpm -r)
pnpm lint             # eslint en todos los paquetes
pnpm test             # tests unitarios (pnpm -r)
pnpm test:e2e         # e2e de web
pnpm build            # build de todos los paquetes
pnpm db:migrate       # supabase db push
pnpm db:types         # genera packages/shared/src/database.types.ts (--linked)
```

Apuntar a una sola app: `pnpm --filter web <script>` / `pnpm --filter mobile <script>`.

## Estructura del proyecto

```
gruas-app/ (monorepo pnpm)
├── apps/
│   ├── mobile/                  App Expo (React Native, SDK 54)
│   │   ├── app/                 Rutas (expo-router) — SOLO routing/screens
│   │   │   ├── (auth)/  (user)/  (operator)/
│   │   ├── features/            Código por dominio (components/hooks/lib)
│   │   │   ├── chat/  notifications/  pin/  rating/  tracking/
│   │   ├── shared/              Transversal (no atado a un dominio)
│   │   │   ├── components/ui/   Design System (Button, Input, Card, …)
│   │   │   └── hooks/           useBudiFonts · useDistanceCalculation
│   │   └── constants/           theme.ts (tokens del Design System)
│   │
│   └── web/                     App Next.js (App Router)
│       └── src/
│           ├── app/             Rutas — cada page.tsx re-exporta su feature
│           ├── features/        Páginas reales por dominio (admin · auth · mop)
│           ├── shared/          Transversal
│           │   ├── components/  BudiLogo · LogoutButton · StatusBadge · …
│           │   └── lib/         supabase/ (client · server · middleware)
│           ├── proxy.ts         Next.js proxy (antes middleware; debe vivir en src/ raíz)
│           └── test/            setup.ts (config de vitest)
│
├── packages/shared/            Tipos y utils compartidos (mobile + web)
│   └── src/                     types/ · utils/ · constants/ · database.types.ts
├── supabase/                   migrations/ · functions/ (Edge) · config.toml
└── package.json
```

## Convención de estructura (post-reestructuración 2026-06)

- **`app/` = solo routing.** En web, cada `page.tsx` es un shim:
  `export { default } from '@/features/<dominio>/<Page>'`. La lógica vive en `features/`.
- **`features/<dominio>/`** = todo lo de un dominio, en `components/`, `hooks/`, `lib/`.
- **`shared/`** = transversal (design system, hooks/lib globales). No depende de ningún feature.
- **`packages/shared`** = lo que comparten móvil **y** web (tipos, utils, constantes).
- Alias **`@/*`** → raíz de cada app: móvil `./*`, web `./src/*`
  (ej. `@/shared/components/ui`, `@/features/tracking/hooks/useETA`).
- Excepciones que NO se mueven a `shared/`: `proxy.ts` (Next lo exige en `src/`)
  y `test/` (lo referencia vitest).

## Notas

- Idioma de la UI: español. Marca: **Budi** (azul `#2D5F8B`, naranja `#F5A25B`).
- Deploy: web en VPS (Docker + Caddy); Supabase managed; móvil vía EAS.
