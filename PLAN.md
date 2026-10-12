# Self-Hosted Cloud on a Raspberry Pi — Build Plan

Status: draft v2, 2026-10-13. Scope of v1: a private Dropbox/Nextcloud-style file cloud
(upload, browse, download, share) for a household, reachable from anywhere.

Settled decisions:
- **Package manager: pnpm** (workspaces). Not npm, not Bun.
- **Runtime: Node.js 24 LTS** everywhere, including production on the Pi.
- **Language: TypeScript `strict`, ESM, for 100 % of the code.** No Python, so no uv.

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Hardware | Raspberry Pi 5, 8 GB, NVMe SSD via M.2 HAT (or USB 3 SSD), active cooler, official 27 W PSU | SD cards die under write load; the SSD holds OS, DB and files. |
| OS | Raspberry Pi OS Lite 64-bit (arm64), headless, SSH keys only | 64-bit is required for current Node and native modules. |
| Runtime | Node.js 24 LTS, pinned in `.nvmrc` and the Docker base image | Next.js and every native module we use are built and tested on Node. |
| Package manager | pnpm, pinned via `"packageManager": "pnpm@<x.y.z>"` in root `package.json` | Fast, disk-efficient, strict: a package can only import what it declares. |
| UI | Next.js (App Router) + React 19, `output: "standalone"` | Standalone output is a small self-contained server — fits the Pi's RAM. |
| API | Express 5 | Sole owner of disk and DB: auth, streaming uploads/downloads, quotas. |
| Uploads | tus protocol: `@tus/server` + `@tus/file-store`, `tus-js-client` in the browser | Large uploads over flaky links resume instead of restarting. |
| DB | SQLite (WAL) via `better-sqlite3` + Drizzle ORM and migrations | One file, zero ops, typed schema. |
| Validation | `zod` in `packages/shared` | One schema → API validation + client types. |
| Passwords | `@node-rs/argon2` (Argon2id, prebuilt arm64 binaries) | Modern KDF, no compiler needed on the Pi. |
| Proxy / TLS | Caddy | Automatic HTTPS, one small config file. |
| Remote access | Tailscale — no open router ports | Removes the public-internet attack surface. Cloudflare Tunnel if guests without Tailscale need access. |
| Packaging | Docker Compose; arm64 images built in CI | Reproducible, rollback by image tag, nothing compiles on the Pi. |
| Tests | Vitest (unit), Supertest (API), Playwright + axe (e2e, accessibility) | |
| Backups | restic → second USB disk + off-site target | One copy of your data is not a cloud. |

## 2. Architecture

```
 phone / laptop ──(Tailscale or LAN)──► Caddy :443
                                          ├── /api/*  ──► Express :4000 ─┬─► SQLite /data/db/cloud.sqlite
                                          │                              └─► Files  /data/files/<userId>/...
                                          └── /*      ──► Next.js :3000 (UI only; calls /api)
```

Invariants (one owner each):

- **Express is the only process that touches `/data`** (files and DB). Next.js renders UI
  and forwards the session cookie; it has no DB driver and no volume mount for `/data`.
- **One function, `resolveUserPath()`, turns client paths into disk paths** and rejects
  anything outside the user's root (`..`, encoded variants, symlinks) before any `fs` call.
- **Writes are atomic:** stream to `/data/tmp`, fsync, `rename` into place, and write the
  metadata row in the same SQLite transaction that commits the move.
- **Quota usage is derived** from the `files` table, updated only inside that transaction.
- **Files are plain files on disk**, not blobs in SQLite — readable and restorable without the app.

## 3. Repository layout (pnpm workspace)

```
self-hosted-cloud/
├── apps/
│   ├── web/                  # @cloud/web  — Next.js UI
│   └── api/                  # @cloud/api  — Express 5
│       ├── src/routes/       # auth, files, shares, admin
│       ├── src/storage/      # resolveUserPath, atomic writes, tus store
│       └── src/db/           # Drizzle schema + migrations
├── packages/
│   └── shared/               # @cloud/shared — zod schemas, API types, error codes
├── deploy/
│   ├── docker-compose.yml
│   ├── Caddyfile
│   └── pi-setup.md           # OS hardening + first-boot runbook
├── .github/workflows/ci.yml
├── package.json              # "packageManager": "pnpm@…", root scripts only
├── pnpm-workspace.yaml       # packages: [apps/*, packages/*] + onlyBuiltDependencies
├── pnpm-lock.yaml
├── tsconfig.base.json  .nvmrc  .npmrc
└── AGENTS.md  CLAUDE.md  CHANGELOG.md  README.md
```

Workspace conventions:

- Internal deps use the workspace protocol: `"@cloud/shared": "workspace:*"`.
- `pnpm-workspace.yaml` lists **`onlyBuiltDependencies`**: `better-sqlite3`, `sharp`,
  `esbuild`. Newer pnpm blocks dependency install scripts unless they're allowlisted, so this
  list is also the record of every package allowed to run code at install time.
- Root scripts fan out with filters:

  | Command | Does |
  |---|---|
  | `pnpm dev` | `pnpm -r --parallel dev` (Next on :3000, API via `tsx watch` on :4000) |
  | `pnpm check` | typecheck + lint + test across all packages — **the gate** |
  | `pnpm --filter @cloud/api test` | one package's tests while iterating |
  | `pnpm build` | `pnpm -r build` (shared → api → web, in dependency order) |

## 4. Data model (v1)

- `users` (id, email, password_hash, role, quota_bytes, created_at)
- `sessions` (id, user_id, expires_at, user_agent) — opaque random ID in an
  `HttpOnly; Secure; SameSite=Lax` cookie; no JWTs needed on a single server.
- `files` (id, owner_id, parent_id, name, kind file|folder, size, mime, sha256,
  created_at, updated_at, deleted_at) — `deleted_at` gives a trash with restore.
- `shares` (id, file_id, token, expires_at, password_hash?, created_by)

## 5. Docker build with pnpm

Two images, both built for `linux/arm64` in CI with `docker buildx`:

- **api:** `pnpm fetch` (layer-cached on the lockfile alone) → `pnpm install --offline`
  → `pnpm --filter @cloud/api build` → `pnpm --filter @cloud/api deploy --prod /out`.
  `pnpm deploy` produces a standalone folder with only that app's production deps, so the
  runtime image carries no workspace or dev tooling. Native modules are installed inside
  this arm64 stage, never copied from a Mac.
- **web:** same `fetch`/`install`, then `next build` with `output: "standalone"` and
  `outputFileTracingRoot` set to the repo root (needed so Next traces `@cloud/shared`
  in a monorepo). Copy `.next/standalone`, `.next/static` and `public/`.
- Runtime base: `node:24-slim` (Debian, glibc — prebuilt arm64 binaries for `sharp` and
  argon2 just work), non-root user, `/data` mounted only into the api container.

## 6. Phases (each ends shippable, tagged, with its own tests)

### Phase 0 — Foundation (0.1.0)
- `git init`, pnpm workspace with the three packages, strict `tsconfig.base.json`
  (project references), ESLint, Prettier, Vitest.
- CI: `pnpm/action-setup` + `actions/setup-node` (pnpm cache) → `pnpm install --frozen-lockfile`
  → `pnpm check` → buildx arm64 images. Actions pinned to SHAs, least-privilege permissions.
- Gitleaks, Dependabot (`package-ecosystem: npm` covers pnpm lockfiles), `.env.example`.
- **Done when:** `pnpm check` is green locally and in CI.

### Phase 1 — Pi baseline (0.2.0)
- Flash Pi OS Lite 64-bit, boot from NVMe, SSH keys only, `ufw` default-deny,
  unattended security upgrades, Docker + Compose, Tailscale.
- Mount the data disk at `/data` (ext4, `noatime`).
- Deploy a hello-world stack (Caddy + empty Next + Express `/api/health`).
- **Done when:** `https://<pi>.<tailnet>.ts.net/api/health` answers from a phone off Wi-Fi.

### Phase 2 — Auth (0.3.0)
- First-run setup creates the admin; admin invites users.
- Login/logout, Argon2id, session cookie, rate-limited login, CSRF protection on
  state-changing routes (SameSite + Origin check).
- **Done when:** Supertest covers login success/failure/lockout and expired sessions.

### Phase 3 — Files core (0.4.0)
- Browse folders, create/rename/move, delete-to-trash and restore.
- tus resumable uploads; streaming downloads with `Range` support (video seeking).
- Quota enforced before an upload accepts bytes.
- UI: file list, breadcrumbs, drag-and-drop upload with progress, keyboard accessible,
  usable at 320 px.
- **Done when:** a 5 GB upload survives a network drop and resumes; traversal tests
  (`../`, URL-encoded, symlinks) are all rejected.

### Phase 4 — Sharing (0.5.0)
- Public share links with expiry and optional password; read-only.
- **Done when:** expired or revoked links return 404, never the file.

### Phase 5 — Media & extras (0.6.0+)
- Image thumbnails with `sharp`, video posters with `ffmpeg`, in a worker with
  concurrency 1–2; photo timeline view.
- Optional: WebDAV endpoint so OS file managers can mount the cloud.

### Phase 6 — Operations (1.0.0)
- restic nightly backups + a documented, *tested* restore.
- Disk-health (`smartctl`) and free-space alerts, log rotation.
- Updates: CI pushes tagged images → `docker compose pull && docker compose up -d` on the
  Pi; rollback = previous tag. Migrations are expand/contract so rollback stays safe.

## 7. Raspberry Pi gotchas

- **Nothing builds or installs on the Pi.** CI produces arm64 images; the Pi only pulls them.
- **Power loss happens:** SQLite WAL + fsync + atomic renames keep data consistent; a
  UPS HAT is a cheap upgrade.
- **Thermals:** thumbnailing pegs the CPU — keep the worker's concurrency low.
- **Memory (8 GB Pi):** Next standalone ~150–250 MB, Express ~100 MB, Caddy ~30 MB —
  the rest becomes page cache, which is what makes file serving fast.

## 8. Decisions you should own (good places to write the code yourself)

1. `resolveUserPath()` — the path-traversal guard (security-critical, ~10 lines).
2. Name-collision policy on upload (overwrite, `name (1).ext`, or ask).
3. Trash retention (forever, 30 days, or until quota pressure).
4. Share-link defaults (expiry length, password required or optional).
