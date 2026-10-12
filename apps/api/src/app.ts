import { access, constants } from "node:fs/promises";
import { sql } from "drizzle-orm";
import express from "express";
import type { HealthResponse } from "@cloud/shared";
import { createAdminRouter } from "./admin/routes.js";
import { createAuthRouter } from "./auth/routes.js";
import { createSessionService } from "./auth/sessions.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { requireSameOrigin } from "./http/csrf.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";

export interface AppOptions {
  config: Config;
  version: string;
  db: Db;
  /** Injectable clock (epoch ms) for rate limiting and session expiry. */
  now?: () => number;
}

async function storageState(dataDir: string): Promise<"ok" | "unavailable"> {
  try {
    await access(dataDir, constants.W_OK);
    return "ok";
  } catch {
    return "unavailable";
  }
}

function databaseState(db: Db): "ok" | "unavailable" {
  try {
    db.get(sql`select 1`);
    return "ok";
  } catch {
    return "unavailable";
  }
}

export function createApp({ config, version, db, now = Date.now }: AppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Caddy

  const sessions = createSessionService({ db, config, now });

  app.use("/api", requireSameOrigin(config.publicOrigin));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", async (_req, res) => {
    const checks = { storage: await storageState(config.dataDir), database: databaseState(db) };
    const healthy = checks.storage === "ok" && checks.database === "ok";
    const body: HealthResponse = { status: healthy ? "ok" : "degraded", version, checks };
    res.status(healthy ? 200 : 503).json(body);
  });

  app.use("/api/auth", createAuthRouter({ db, sessions, now }));
  app.use("/api/admin", createAdminRouter({ db, sessions, now }));
  app.use("/api", notFoundHandler);
  app.use(errorHandler);

  return app;
}
