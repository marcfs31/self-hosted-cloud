import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 3100;
const API_PORT = 4100;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

// A fresh data directory per run keeps the first-run flow reproducible. It is created by the
// API's webServer command (mkdir -p) because apps/web must not import node:fs.
const dataDir = join(tmpdir(), `cloud-e2e-${process.pid}-${Date.now()}`);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        'mkdir -p "$DATA_DIR" && pnpm --dir ../api exec tsx --conditions=@cloud/source src/server.ts',
      env: { DATA_DIR: dataDir, PUBLIC_ORIGIN: WEB_ORIGIN, PORT: String(API_PORT) },
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec next dev --port ${WEB_PORT}`,
      env: { API_ORIGIN: `http://localhost:${API_PORT}` },
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
