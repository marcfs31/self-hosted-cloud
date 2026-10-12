# syntax=docker/dockerfile:1
# Build from the repo root:  docker buildx build -f apps/web/Dockerfile -t cloud-web .

# ---- fetch: lockfile-only layer, cached until pnpm-lock.yaml (or the pinned pnpm) changes
FROM node:24-slim AS fetch
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# ---- build
FROM fetch AS build
# Next bakes rewrites at build time: this is where /api/* is forwarded inside the compose
# network. Caddy normally routes /api/* before it ever reaches Next.
ARG API_ORIGIN=http://api:4000
ENV API_ORIGIN=${API_ORIGIN}
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --offline --frozen-lockfile --filter "@cloud/web..."
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter "@cloud/web..." build
# public/ is optional in the source tree; keep the runtime COPY below valid either way.
RUN mkdir -p apps/web/public

# ---- runtime: Next standalone output (outputFileTracingRoot is the repo root, so the
# server lives at apps/web/server.js inside the standalone folder)
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
