# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-10-13

### Added

- Share files and folders by link, with an expiry (1 day to 1 year, or never) and an optional
  password; links are shown once and can be revoked from the "Shared links" page.
- Shared folders can be browsed and downloaded as a zip, streamed without temporary files.
- Drop boxes: a folder link that lets anyone upload into that folder without seeing it.
- Public share pages work without an account and in all five languages.

## [0.6.0] - 2026-10-13

### Added

- Search across all folders by any part of a name, with live results, the folder path of each
  result, and a `/` keyboard shortcut.
- Full-screen previews for images, video, audio, PDF and text files, with next/previous and
  keyboard navigation; text previews read at most the first 1 MiB.

## [0.5.0] - 2026-10-13

### Added

- File browser: folders, breadcrumbs, rename, move, download, in all five languages.
- Resumable uploads (tus): pause, resume, retry, and resume after a reload; drag and drop.
- Version history: uploading onto an existing name asks Replace (keeps the old version) or
  Keep both; versions can be downloaded, restored and deleted.
- Trash with restore, delete forever and empty trash; items are purged after 30 days.
- Storage usage meter; admins see each user's used space.
- Files are stored by ID only, never by name, and served with safe headers (no inline HTML).

## [0.4.0] - 2026-10-13

### Added

- The web app speaks English, Portuguese (Portugal), Spanish, Catalan and Italian.
- Language switcher in the header and on the sign-in pages; the choice is remembered per device.
- Without a choice, the browser's language is used, falling back to English.
- Dates and sizes are formatted for the chosen language.
- End-to-end and accessibility tests run in every language.

## [0.3.0] - 2026-10-13

### Added

- SQLite database (WAL) with Drizzle migrations at `<DATA_DIR>/db/cloud.sqlite`; health reports it.
- First-run setup creates the admin; login and logout with Argon2id passwords.
- Sessions in an HttpOnly cookie, stored as SHA-256 hashes, 30-day sliding expiry.
- Invites (admin creates, single use, expiring, revocable) and member registration.
- Admin page to change members' role and quota.
- Login, setup and registration rate limiting (5 failures per 15 minutes).
- Same-origin check on every state-changing request; errors are codes, never free text.
- Web sign-in pages, admin UI, and end-to-end tests with axe accessibility checks in CI.

### Fixed

- The api image now builds when native modules must be compiled from source.

## [0.2.0] - 2026-10-13

### Added

- Environment validation at startup: `DATA_DIR` and `PUBLIC_ORIGIN` are required.
- Health check reports storage writability and answers 503 when degraded.
- arm64 Docker images for api and web, built on `node:24-slim` and run as non-root.
- Docker Compose stack behind Caddy with automatic Tailscale (`*.ts.net`) certificates.
- Raspberry Pi setup runbook (`deploy/pi-setup.md`).
- CI publishes images to GHCR for version tags once the gate passes.

## [0.1.0] - 2026-10-13

### Added

- pnpm workspace with `@cloud/shared`, `@cloud/api` and `@cloud/web`, strict TypeScript 6.
- `GET /api/health` returning status and version.
- Next.js app shell with light/dark design tokens and visible focus styles.
- Gate: `pnpm check` (Prettier, ESLint, typecheck, Vitest, version consistency).
- CI running the gate, the build and gitleaks; Dependabot for npm and Actions.
