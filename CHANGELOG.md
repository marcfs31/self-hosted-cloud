# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.13.0] - 2026-10-13

### Added

- `cloud` command-line tool: `login` (with an app password, stored with owner-only file
  permissions), `whoami`, `ls`, `upload` (resumable, `--recursive`, `--replace`), `download`,
  `mkdir`, `mv`, `rm` (to the trash), `search` and `share`; `--json` output for scripts and
  distinct exit codes per failure kind.

## [0.12.0] - 2026-10-13

### Added

- The activity log now also records uploads (including drop-box uploads), moves to the trash,
  restores, permanent deletes (marked when done by the 30-day clean-up) and share links
  created or revoked.
- Change feed (`GET /api/changes`) for sync clients: each changed item's latest state since a
  cursor, usable with an app password. Existing files are included from the first sync.

## [0.11.0] - 2026-10-13

### Added

- Install the cloud as an app on your phone or desktop (web app manifest, icons, install
  button, and an Add to Home Screen hint on iPhone).
- Works offline for the app shell; file contents and API responses are never cached.
- An in-app prompt when an update is available.
- Share files from other Android apps straight into the cloud.
- Phone photo backup: pick photos and videos, and only the ones not already in the cloud are
  uploaded (checked by content hash). It runs while the page is open.
- Take a photo with the camera and upload it directly.

## [0.10.0] - 2026-10-13

### Added

- Admin system dashboard: CPU temperature and load, memory, storage, and the results of the
  last backup, restore test and health check; anything missing or out of date shows as
  Unknown or Stale, never as healthy.
- `backup-db` command for a consistent online copy of the database while the cloud runs.
- Nightly restic backups to one or more repositories, a monthly automated restore test and a
  15-minute health check (including disk SMART status), as systemd timers.
- Operations runbook: updates, rollback, backups, disaster recovery and migration policy.

## [0.9.0] - 2026-10-13

### Added

- Sign in with a passkey (Face ID, Touch ID, Windows Hello or a security key).
- Two-step verification with an authenticator app, plus ten single-use recovery codes.
- App passwords: named, revocable tokens for the command-line tool, WebDAV and desktop sync.
- Activity log of sign-ins and security changes; admins see security events for everyone.
- Admins can reset a member's two-step verification.

### Fixed

- The header navigation wraps on narrow screens instead of scrolling sideways.

## [0.8.0] - 2026-10-13

### Added

- Photos timeline grouped by month, ordered by the date each photo was taken (read from the
  photo itself, falling back to the upload date), with a lightbox and video playback.
- Albums: create, rename, add a selection of photos, remove photos, delete (photos stay in your
  files).
- Thumbnails for images and videos, generated on the server and cached.

### Changed

- The api image now includes ffmpeg for video thumbnails.

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
