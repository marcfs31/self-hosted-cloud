import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { purgeExpiredTrash } from "./files/trash.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const config = loadConfig(process.env);
const db = openDatabase(join(config.dataDir, "db", "cloud.sqlite"));
const app = createApp({ config, version, db });

const HOUR_MS = 60 * 60 * 1000;
const maintenance = setInterval(() => {
  app.cleanUpUploads().catch((err: unknown) => {
    console.error("upload cleanup failed:", err instanceof Error ? err.name : "unknown");
  });
  purgeExpiredTrash({ db, dataDir: config.dataDir, now: Date.now }).catch((err: unknown) => {
    console.error("trash sweep failed:", err instanceof Error ? err.name : "unknown");
  });
}, HOUR_MS);
maintenance.unref();

const server = app.listen(config.port, () => {
  console.log(`api ${version} listening on :${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(maintenance);
    server.close(() => {
      db.$client.close();
      process.exit(0);
    });
  });
}
