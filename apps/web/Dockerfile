# syntax=docker/dockerfile:1
# Self-contained image for the tenant-facing web app (#439). Built from the
# monorepo root:
#
#   docker build -f apps/web/Dockerfile -t ciele-web .
#   docker run -p 3000:3000 --env-file apps/web/.env.local ciele-web
#
# Next.js `output: "standalone"` (next.config.ts) traces every runtime file
# into .next/standalone, so the final stage ships no node_modules install of
# its own. Env is read at RUNTIME (platform provider keys, Supabase, secrets)
# — the image itself embeds no credentials. NEXT_PUBLIC_* values are inlined
# at build time; pass them as build args when they must differ from defaults.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# Install workspace deps from the lockfile only — this layer is cached until
# the lockfile or a manifest changes, keeping rebuilds fast and reproducible.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
# Only the manifests this filtered install resolves. pnpm accepts a lockfile
# that still carries importers whose workspace directory is absent, so sibling
# apps the image never ships need no placeholder manifest here — which also
# keeps this Dockerfile buildable from the open-source tree, where the
# enterprise apps do not exist at all.
#
# But every workspace package apps/web *does* depend on, directly or through
# another, needs its manifest here: without it pnpm links no node_modules for
# that directory, and the build fails compiling its source (packages ship as
# source, so Turbopack compiles them in place — a missing link surfaces as
# "Module not found: Can't resolve '@agent-hub/core'" from inside the package,
# not as a missing dependency of the app). `deploy/compose.test.mjs` derives
# the closure from the manifests and fails if one is missing from this list.
COPY apps/web/package.json apps/web/
COPY packages/agent/package.json packages/agent/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ops/package.json packages/ops/
COPY packages/ui/package.json packages/ui/
COPY packages/charts/package.json packages/charts/
COPY packages/ops/package.json packages/ops/
RUN pnpm install --frozen-lockfile --filter @agent-hub/web...

FROM deps AS build
COPY packages ./packages
COPY apps/web ./apps/web
# NEXT_PUBLIC_* is inlined into the browser bundle at build time, so a
# self-host has to bake in its own Supabase origin and anon key (#440). Left
# empty the image still builds and runs — the app falls back to its in-memory
# demo store, which is what the CI smoke test exercises.
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN pnpm --filter @agent-hub/web build

FROM node:22-alpine AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup --system nodejs && adduser --system --ingroup nodejs nextjs
# Standalone output keeps the monorepo layout: the server entry lives at
# apps/web/server.js inside the traced bundle. Static assets and public/ are
# deliberately not traced by Next and must ride alongside.
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
