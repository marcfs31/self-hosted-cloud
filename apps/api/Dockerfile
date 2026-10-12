# syntax=docker/dockerfile:1
# Build from the repo root:  docker buildx build -f apps/api/Dockerfile -t cloud-api .

# ---- fetch: lockfile-only layer, cached until pnpm-lock.yaml (or the pinned pnpm) changes
FROM node:24-slim AS fetch
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
RUN corepack enable
# Toolchain for native modules (better-sqlite3) when no prebuilt binary matches. pnpm fetch
# already runs their install scripts, so it is needed from this stage on. The runtime stage
# starts from a fresh base image and never inherits it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# ---- build: compile TypeScript and produce a prod-only deploy folder
FROM fetch AS build
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --offline --frozen-lockfile --filter "@cloud/api..."
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# Builds @cloud/shared, then @cloud/api (topological).
RUN pnpm --filter "@cloud/api..." build
# The migrations folder may not exist yet; keep the runtime COPY below valid either way.
RUN mkdir -p apps/api/drizzle
# pnpm 10 only deploys workspace dependencies when they are injected: the documented
# setting inject-workspace-packages (CLI form --config.*) makes @cloud/shared a real copy.
RUN pnpm --config.inject-workspace-packages=true --filter @cloud/api deploy --prod /out

# ---- runtime
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data
WORKDIR /app
RUN mkdir /data && chown node:node /data
# Only what runs: the deployed package has no "files" allowlist, so it also carries src,
# tests and tsconfigs. dist/ also holds operational entry points (e.g. backup-db.js).
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/drizzle ./drizzle
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
