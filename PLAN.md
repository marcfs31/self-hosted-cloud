# Self-Hosted Cloud on a Raspberry Pi — Build Plan

Status: v3, 2026-10-13. A private, multilingual Dropbox/Google-Photos-style cloud for a
household, running on a Raspberry Pi 5 and reachable from anywhere over Tailscale.

Released so far: **v0.1.0 → v0.16.0** (all phases 0–13 built; see §9 for status and what is left
before 1.0).

Settled decisions:

- **Package manager: pnpm** (workspaces). **Runtime: Node.js 24 LTS** everywhere.
- **Language: TypeScript `strict`, ESM, for 100 % of the code.** No Python, so no uv.
- **Locales: English (`en`, default), Portuguese (`pt-PT`), Spanish (`es`), Catalan (`ca`),
  Italian (`it`).** Every UI string exists in all five in the same change.
- **Clients address files by ID, never by path** (removes path traversal as a class).

## 1. Stack

| Concern         | Choice                                                                       | Why                                                               |
| --------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Hardware        | Raspberry Pi 5, 8 GB, NVMe SSD (M.2 HAT), active cooler, 27 W PSU            | SD cards die under write load.                                    |
| OS              | Raspberry Pi OS Lite 64-bit, headless, SSH keys only                         | 64-bit is required for current Node and native modules.           |
| Runtime         | Node.js 24 LTS (`.nvmrc`, `node:24-slim` images)                             | Next.js and our native modules are tested on Node.                |
| Package manager | pnpm, pinned via `packageManager`                                            | Strict, fast; `onlyBuiltDependencies` allowlists install scripts. |
| Web UI          | Next.js 16 (App Router) + React 19, `output: "standalone"`, installable PWA  | One codebase for desktop browsers and the phone app.              |
| API             | Express 5 — the only process that touches `/data`                            | Streaming uploads/downloads, auth, quotas, WebDAV.                |
| Uploads         | tus (`@tus/server`, `@tus/file-store`, `tus-js-client`)                      | Interrupted uploads resume.                                       |
| DB              | SQLite (WAL) via `better-sqlite3` + Drizzle migrations; FTS5 for search      | One file, zero ops.                                               |
| Auth            | Argon2id passwords, WebAuthn passkeys (`@simplewebauthn/*`), TOTP (in-house) | Phishing-resistant sign-in; TOTP is ~40 lines on `node:crypto`.   |
| Media           | `sharp` thumbnails, `ffmpeg` video posters, `exifr` for photo dates/GPS      | Small, arm64-ready.                                               |
| i18n            | In-house typed dictionaries + `Intl` formatters (no i18n library)            | Missing keys fail typecheck; dates/sizes formatted per locale.    |
| CLI             | `apps/cli` — Node 24, `tus-js-client`, app-password auth                     | Same contract package as the web.                                 |
| Desktop sync    | `apps/desktop` — Electron + TypeScript tray app                              | Only mainstream all-TypeScript desktop shell (Tauri needs Rust).  |
| Proxy / TLS     | Caddy with Tailscale `*.ts.net` certificates                                 | Automatic HTTPS, no open router ports.                            |
| Packaging       | Docker Compose; arm64 images built in CI only after the gate passes          | Rollback by image tag, nothing compiles on the Pi.                |
| Tests           | Vitest, Supertest, Playwright + axe (every locale), litmus for WebDAV        |                                                                   |
| Backups         | restic → USB disk + off-site, nightly; monthly automated restore test        | One copy of your data is not a cloud.                             |

## 2. Architecture

```
 browser / PWA ─┐
 CLI ───────────┤                       ┌─ /api/*   ─► Express :4000 ─┬─► SQLite  /data/db/cloud.sqlite
 desktop sync ──┼─(Tailscale)─► Caddy ──┼─ /dav/*   ─► Express :4000  ├─► blobs   /data/files/<owner>/<v[0..2]>/<versionId>
 Finder/Explorer┘   :443                └─ /*       ─► Next.js :3000  ├─► uploads /data/tmp, thumbs /data/thumbs
                                                                      └─◄ status  /data/status/*.json (written by host timers)
```

Invariants (one owner each):

- **Only `apps/api` touches `/data`.** The web, CLI and desktop app speak HTTP only.
- **The contract lives in `packages/shared`** (zod). The API validates with it; clients import types.
- **IDs, not paths.** Names and the tree exist only in SQLite; blobs are keyed by version ID.
- **Every query is scoped by `owner_id`;** a missing or foreign ID is 404, never 403.
- **Atomic writes:** temp file → fsync → `rename` → metadata rows in one SQLite transaction.
- **Quota usage is derived** (`SUM(size)` over all versions, trashed included), never stored.
- **Secrets are stored hashed** (Argon2id passwords; SHA-256 session, share, invite and app tokens).
- **Every mutation bumps a per-user change sequence** (`files.rev`), the feed desktop sync reads.
- **Every security-relevant action writes one activity row** in the same transaction.
- **No telemetry, no third-party requests, no remote fonts or scripts.**

## 3. Repository layout

```
apps/
  web/        Next.js UI + PWA          (@cloud/web)
  api/        Express API + WebDAV      (@cloud/api)
  cli/        `cloud` command           (@cloud/cli)      — Phase 13
  desktop/    Electron sync app         (@cloud/desktop)  — Phase 14
packages/
  shared/     zod contracts, error codes, pure helpers (@cloud/shared)
deploy/       compose, Caddy, Pi runbook, backup/health scripts, systemd units
```

## 4. Data model (target)

- `users` (id, email, password_hash, role, quota_bytes, totp_secret?, created_at)
- `sessions` (token_hash, user_id, created_at, expires_at, user_agent, mfa_passed)
- `invites` (id, token_hash, role, created_by, created_at, expires_at, used_at, revoked_at)
- `files` (id, owner_id, parent_id, name, kind, current_version_id, rev, created_at,
  updated_at, deleted_at) — one row per file or folder; the root folder has `parent_id NULL`
- `file_versions` (id, file_id, size, sha256, mime, created_at, taken_at?, width?, height?) —
  the blob for a version lives at `/data/files/<owner>/<id[0..2]>/<id>`
- `shares` (id, file_id, token_hash, kind file|folder, allow_upload, expires_at,
  password_hash?, created_by, created_at, revoked_at)
- `albums`, `album_items` · `passkeys` · `app_passwords` (token_hash, name, last_used_at) ·
  `activity` (id, user_id, type, file_id?, meta json, ip, created_at) · `files_fts` (FTS5)

## 5. Phases

Each phase ends shippable: its own tests, all five locales, `pnpm check` + e2e green, a
`chore(release)` commit and an annotated tag. Pre-1.0, every phase is a minor bump.

### ✅ Phase 0 — Foundation (0.1.0) · Phase 1 — Pi baseline (0.2.0) · Phase 2 — Auth (0.3.0)

Workspace, CI, gitleaks, Dependabot; Docker images, Compose + Caddy + Tailscale, Pi runbook;
first-run setup, sessions, invites, rate limiting, same-origin checks, admin UI, e2e + axe.

### Phase 3 — Internationalisation (0.4.0)

- Typed dictionaries `en` (source), `pt-PT`, `es`, `ca`, `it`; `Messages` type makes a missing
  key a compile error, plus a test that no value is empty or identical to English by accident
  (allowlist for words such as "Email").
- Locale resolution: `locale` cookie (set by the switcher, per device) → `Accept-Language` →
  `en`; switcher in the header and on sign-in pages; `<html lang>` follows; dates, sizes and
  plurals via `Intl`.
- e2e and axe run on one page per locale.
- **Done when:** every page renders in all five locales with no missing key and axe clean.

### Phase 4 — Files core with version history (0.5.0)

- Browse, create folder, rename, move, trash (30-day retention), restore, delete forever.
- tus uploads with resume; Range downloads; quota checked before bytes are accepted.
- **Version history:** uploading onto an existing name asks "Replace (keeps the old version)" or
  "Keep both" (`name (1).ext`). Versions list, download and restore; old versions count toward
  quota.
- Usage meter; admin users table shows used / quota.
- **Done when:** an interrupted upload resumes from its offset; invalid names are rejected;
  user B gets 404 for every one of user A's IDs; restoring version 1 serves version 1's bytes.

### Phase 5 — Search and previews (0.6.0)

- Name search across all folders (SQLite FTS5 trigram, results scoped to the owner), with
  folder path shown per result; keyboard shortcut `/`.
- Preview overlay with next/previous: images, video, audio (native players), PDF (browser
  viewer in a sandboxed frame), text/Markdown shown as text.
- **Done when:** search returns substring matches in under 100 ms on 100 000 rows; previews
  never execute uploaded content (CSP sandbox test).

### Phase 6 — Sharing (0.7.0)

- Share files **and folders** by link: expiry (default 7 days, 1–365 or never), optional
  password, revoke. A folder share browses read-only and downloads the folder as a **zip**
  (streamed, no temp file).
- **Drop box:** a folder link that only allows uploading into that folder (no listing).
- "My shares" page.
- **Done when:** expired or revoked links return 404; a share never exposes anything outside
  its subtree; drop-box uploads count against the owner's quota.

### Phase 7 — Photos (0.8.0)

- Thumbnails (`sharp`, video posters via `ffmpeg`) generated in a worker, concurrency 2.
- Timeline grouped by **date taken** (EXIF `DateTimeOriginal`, falling back to upload time);
  albums (create, add/remove, rename, share an album as a folder-style link).
- **Done when:** a 5 000-photo library scrolls smoothly on a phone; missing EXIF falls back
  visibly, not silently.

### Phase 8 — Security (0.9.0)

- **Passkeys** (register several, sign in passwordless) and **TOTP 2FA** with recovery codes
  for password sign-ins; admin can reset a member's second factor.
- **App passwords:** named, revocable tokens for the CLI, WebDAV and desktop sync
  (shown once, stored hashed, last-used time shown).
- **Activity log:** sign-ins (success/failure), uploads, deletions, shares, security changes;
  each user sees their own, admins see security events for everyone.
- **Done when:** a password-only login with 2FA enabled cannot reach any file endpoint; an
  app password cannot change account security settings.

### Phase 9 — System dashboard and operations (0.10.0)

- Host timers (already written in `deploy/`) write `/data/status/{health,backup,restore-test}.json`;
  the API reads them plus CPU temperature, load, memory and `/data` free space.
- Admin **dashboard**: temperature, disk and SMART health, last backup and restore-test result,
  service health, running version; every value shows "unknown" when its source is missing.
- `backup-db` command for consistent SQLite snapshots; backups and restore runbook complete.
- **Done when:** a missing or stale status file shows as unknown/stale, never as healthy.

### Phase 10 — Phone app (PWA) and photo backup (0.11.0)

- Web app manifest, icons, hand-written service worker (app shell offline, never caches file
  contents or API responses), install prompt.
- Android share target ("Share → Cloud"); camera capture upload.
- **Photo backup:** pick a folder of photos; the app hashes each photo locally and uploads only
  those the server does not already have (`POST /api/files/exists` by SHA-256). It runs while the
  app is open; browsers do not allow fully automatic background backup, especially on iOS.
- **Done when:** re-running backup on the same 500 photos uploads 0 bytes.

### Phase 11 — WebDAV (0.12.0)

- `/dav/` (class 1 + 2: PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, LOCK, UNLOCK),
  Basic auth with **app passwords only**. Writes create new versions; deletes go to trash.
- **Done when:** the `litmus` WebDAV test suite passes its basic, copymove, props and locks
  groups, and the share mounts read/write in macOS Finder and Windows Explorer.

### Phase 12 — Command-line tool (0.13.0)

- `cloud login | ls | upload | download | mkdir | mv | rm | share | search`, resumable uploads,
  JSON output flag, app-password auth stored in the OS config dir (mode 0600).
- **Done when:** the CLI's own e2e suite runs against a live API in CI.

### Phase 13 — Desktop sync app (0.14.0)

- `GET /api/changes?since=<rev>` change feed (cursor-based, scoped to the user).
- Electron tray app: choose a local folder, two-way sync, conflicts kept as
  `name (conflicted copy <device> <date>).ext`, pause/resume, status in the tray.
- Unsigned builds for macOS and Windows from CI (code signing needs paid certificates).
- **Done when:** a scripted three-way scenario (edit on web, edit locally, delete on CLI) converges
  without losing either edit.

### Phase 14 — 1.0.0

- Full Opus security review across all surfaces; fixes landed.
- Verified on a real Pi 5: runbook end to end, restore test, a week of nightly backups.
- From 1.0, a non-rollable migration is a major version.

## 6. How the work is parallelised

Tracks run as parallel workflow agents (Sonnet), each in its own git worktree and branch, and
**never share files**. The orchestrating session owns git, contracts and merges:

- Before a wave: write each track's contract in `packages/shared`, install its dependencies,
  create its worktree (`.claude/worktrees/<track>`). Agents never add dependencies or run git.
- E2E ports come from `E2E_WEB_PORT` / `E2E_API_PORT`, so parallel tracks don't collide.
- Agents may generate Drizzle migrations to test; at merge the migration is regenerated from
  the merged schema so numbering stays linear.
- After a wave: atomic commits per track, merge into `main` in phase order, `pnpm install` to
  reconcile the lockfile, full gate + e2e, then `chore(release)` and tag.

| Wave | Parallel tracks                                                            | Releases        |
| ---- | -------------------------------------------------------------------------- | --------------- |
| A    | i18n (web) · files API                                                     | 0.4.0           |
| B    | files web · search API · sharing API · photos API · security API · ops API | 0.5.0           |
| C    | search web · sharing web · photos web · security web · dashboard web · PWA | 0.6.0 – 0.11.0  |
| D    | WebDAV · CLI · change feed + desktop app                                   | 0.12.0 – 0.14.0 |
| E    | Opus security review → fixes; real-Pi verification                         | 1.0.0           |

## 7. Raspberry Pi gotchas

- **Nothing builds on the Pi.** CI produces arm64 images; the Pi only pulls them.
- **Power loss happens:** WAL + fsync + atomic renames keep data consistent; a UPS HAT is cheap.
- **Thermals:** thumbnailing and zip streaming are CPU-bound; both run with bounded concurrency.
- **Memory (8 GB):** web ~250 MB, api ~150 MB, Caddy ~30 MB; the rest is page cache.

## 8. Chosen defaults (each lives in one place)

1. Name collisions: uploads ask Replace (new version) or Keep both; restores get `name (1).ext`;
   create/rename onto a taken name is refused with `name_conflict`.
2. Trash retention: 30 days. Old versions: kept until the file is deleted or the user prunes.
3. Share links: 7-day default expiry, password optional.
4. Portuguese is European Portuguese (`pt-PT`).

## 9. Status (2026-10-13)

Built and released in phase order; actual versions differ from §5 because integration work got
its own release: 0.4.0 i18n · 0.5.0 files · 0.6.0 search · 0.7.0 sharing · 0.8.0 photos ·
0.9.0 security · 0.10.0 dashboard/ops · 0.11.0 PWA · 0.12.0 activity wiring + change feed ·
0.13.0 CLI · 0.14.0 WebDAV · 0.15.0 desktop sync · 0.16.0 fixes from an independent security
review (7 medium findings, all reproduced and fixed with tests).

Gate at 0.16.0: 976 unit/integration tests (shared 22, web 216, api 454, cli 79, desktop 205)
and 114 Playwright e2e tests with axe in five locales.

Open before 1.0 (the 1.0 gate is a verified run on a real Pi 5):

- Hardware: run `deploy/pi-setup.md` end to end, a week of nightly backups, a monthly restore
  test, Tailscale certificates through Caddy, `/sys` thermal readings in the container.
- Not verified here: the arm64 api image with ffmpeg + sharp (Docker was unavailable after a
  disk-full event), the Caddyfile (`caddy validate`), WebDAV against `litmus`, Finder/Explorer
  mounts, desktop builds other than macOS arm64, Android share target on a real device.
- Low-severity review findings, deferred: step-up re-authentication before creating app
  passwords/passkeys; a Content-Security-Policy for the web app; CLI refusing plain http to
  non-localhost servers; expiry for share-target files cached by the service worker;
  the Caddy container's access to the tailscaled socket; drop-box zero-byte flooding; names
  that `uniqueName` can push past 255 characters; the global change sequence leaking activity
  volume across users.
- Product gaps: a "sign out everywhere" button and password change in the web UI (the API
  endpoint exists); activity-log retention; TOTP secrets stored unencrypted in SQLite; PDF
  previews may be blank in Chromium's sandboxed frame; the desktop app has no icon and is
  unsigned.
