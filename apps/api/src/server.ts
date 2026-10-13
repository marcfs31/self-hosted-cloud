import { readFileSync } from "node:fs";
import { join } from "node:path";
import { purgeOldActivity } from "./activity/retention.js";
import { createApp } from "./app.js";
import { sealLegacyTotpSecrets } from "./auth/secret-box.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { purgeExpiredTrash } from "./files/trash.js";
import { EXTRACT_BATCH, extractPending } from "./photos/media-info.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const config = loadConfig(process.env);
const db = openDatabase(join(config.dataDir, "db", "cloud.sqlite"));
// TOTP seeds written before SECRET_KEY existed are sealed now, in one transaction.
const sealed = sealLegacyTotpSecrets(db, config.secretKey);
if (sealed > 0) console.log(`sealed ${sealed} legacy TOTP secret(s)`);
const app = createApp({ config, version, db });

const HOUR_MS = 60 * 60 * 1000;
const maintenance = setInterval(() => {
  app.cleanUpUploads().catch((err: unknown) => {
    console.error("upload cleanup failed:", err instanceof Error ? err.name : "unknown");
  });
  purgeExpiredTrash({ db, dataDir: config.dataDir, now: Date.now }).catch((err: unknown) => {
    console.error("trash sweep failed:", err instanceof Error ? err.name : "unknown");
  });
  try {
    purgeOldActivity(db, Date.now);
  } catch (err) {
    console.error("activity retention failed:", err instanceof Error ? err.name : "unknown");
  }
}, HOUR_MS);
maintenance.unref();

// Photo dates and sizes are read in the background, one file at a time; a full batch means more
// are waiting, so keep going until the queue is drained.
let extracting = false;
async function extractMediaInfo(): Promise<void> {
  if (extracting) return;
  extracting = true;
  try {
    let handled: number;
    do {
      handled = await extractPending({ db, dataDir: config.dataDir });
    } while (handled === EXTRACT_BATCH);
  } catch (err) {
    console.error("media info extraction failed:", err instanceof Error ? err.name : "unknown");
  } finally {
    extracting = false;
  }
}
const EXTRACT_INTERVAL_MS = 15 * 1000;
const extractor = setInterval(() => void extractMediaInfo(), EXTRACT_INTERVAL_MS);
extractor.unref();
void extractMediaInfo();

const server = app.listen(config.port, () => {
  console.log(`api ${version} listening on :${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(maintenance);
    clearInterval(extractor);
    server.close(() => {
      db.$client.close();
      process.exit(0);
    });
  });
}
