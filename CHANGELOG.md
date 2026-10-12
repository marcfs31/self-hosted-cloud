# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
