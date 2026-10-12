# Self-Hosted Cloud

A private, self-hosted file cloud that runs on a Raspberry Pi 5. Upload, browse, download
and share files from any device on your Tailscale network.

## Develop

```bash
pnpm install
pnpm dev            # web on http://localhost:3000, API on http://localhost:4000
pnpm check          # the full gate
```

Requires Node 24 (`.nvmrc`) and pnpm (pinned in `package.json`).

## Deploy

See [`deploy/pi-setup.md`](deploy/pi-setup.md).

## Layout

| Path              | What                                                |
| ----------------- | --------------------------------------------------- |
| `apps/web`        | Next.js UI                                          |
| `apps/api`        | Express API — the only process that touches `/data` |
| `packages/shared` | zod schemas and types shared by both                |
| `deploy`          | Docker Compose, Caddy, Pi runbook, backup scripts   |
