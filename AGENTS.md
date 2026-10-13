# Self-Hosted Cloud — AGENTS.md

A private file cloud for a Raspberry Pi 5: Next.js UI (`apps/web`), Express API (`apps/api`),
shared zod contracts (`packages/shared`). Plan and phase status: `PLAN.md` (source of truth on
resume — not conversation memory).

## Non-negotiables

1. **Only `apps/api` touches `/data`** (files, SQLite, temp uploads). `apps/web` never imports
   `fs`, a DB driver, or `@cloud/api`; it talks to the API over HTTP only.
2. **The API contract lives in `packages/shared`.** Request/response shapes are zod schemas
   there; the API validates with them, the web imports their types with `import type`.
3. **Clients address files by ID, never by path.** Blobs live at
   `/data/files/<ownerId>/<id[0..2]>/<id>`; names exist only in SQLite. No client string is
   ever joined into a filesystem path.
4. **Every file/folder query is scoped by `owner_id`** of the session user. A missing or
   foreign ID is a 404, never a 403 (no existence oracle).
5. **Writes are atomic:** temp file → fsync → `rename` → metadata row in one SQLite
   transaction. Quota usage is derived (`SUM(size)`), never stored.
6. **Secrets are stored hashed:** passwords with Argon2id, session/share/invite tokens as
   SHA-256. A raw token is shown once and never logged.
7. **No telemetry, no third-party requests, no remote fonts or scripts.**
8. **Every UI string exists in en, pt-PT, es, ca and it in the same change.** `en` is the source;
   the other locales are typed from it, and `messages.test.ts` fails on empty or untranslated values.

## Gate (identical to CI)

```bash
pnpm check   # prettier --check, eslint, tsc --noEmit (all packages), vitest, version check
pnpm build   # shared → api → web, topological
```

Merge method: no remote yet; phases land on `main` via fast-forward from a `feat/*` branch.
Release: manual bump of every `package.json` + `CHANGELOG.md` → `chore(release): X.Y.Z` →
annotated tag `vX.Y.Z`. `pnpm versions:check` fails if manifests or changelog disagree.

## Where to edit

| Need                                    | Place                                                                                | Not                           |
| --------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------- |
| A new endpoint's request/response shape | `packages/shared/src/*.ts`                                                           | inline types in api or web    |
| An error the UI shows                   | add the code to `errorCode` in `packages/shared`, copy in `apps/web/lib/messages.ts` | free-text errors from the API |
| A DB table/column                       | `apps/api/src/db/schema.ts` + `pnpm --filter @cloud/api db:generate`                 | hand-written SQL migrations   |
| A new env variable                      | `apps/api/src/config.ts` (zod) + `.env.example` + `deploy/`                          | `process.env` elsewhere       |
| A UI string                             | `apps/web/lib/messages.ts`                                                           | component files               |
| A colour/spacing value                  | CSS variables in `apps/web/app/globals.css`                                          | raw hex in components         |

## Out of scope unless asked

- WebDAV, folder sharing, EXIF-based photo dates, multi-node storage.
- TypeScript 7 (typescript-eslint supports < 6.1 as of 2026-10-13).
- New runtime dependencies without a stated reason in the commit body.

## Before you finish

- [ ] `pnpm check && pnpm build` green; output quoted.
- [ ] Every bug fix has a failing-then-passing test at the narrowest layer.
- [ ] Ownership test for every new file/share endpoint (user B gets 404 on user A's ID).
- [ ] UI changes keyboard-usable, labelled, usable at 320 px, tokens only.
- [ ] Version + CHANGELOG bumped when behaviour changed; one version in every manifest.

## Decisions already made

| Date       | Decision                                                          | Why                                                                              |
| ---------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 2026-10-13 | pnpm + Node 24, no Bun, no Python/uv                              | Next.js and native modules are tested on Node; all-TypeScript requirement.       |
| 2026-10-13 | TypeScript 6.0.x                                                  | typescript-eslint peer range excludes 7.                                         |
| 2026-10-13 | ID-addressed blob storage instead of a mirrored folder tree       | Removes the path-traversal class; DB is the single owner of names and hierarchy. |
| 2026-10-13 | ESLint config in TS via `--flag unstable_native_nodejs_ts_config` | Avoids adding `jiti`.                                                            |
