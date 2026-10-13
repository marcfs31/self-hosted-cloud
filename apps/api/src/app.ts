import { access, constants } from "node:fs/promises";
import { sql } from "drizzle-orm";
import express from "express";
import type { HealthResponse } from "@cloud/shared";
import { createActivityRouter } from "./activity/routes.js";
import { createAdminRouter } from "./admin/routes.js";
import { createAppPasswordRouter } from "./auth/app-passwords.js";
import { createMfaRouter } from "./auth/mfa-routes.js";
import { createPasskeyRouter } from "./auth/passkeys.js";
import { createAuthRouter } from "./auth/routes.js";
import { createSessionService } from "./auth/sessions.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { rejectBearerOnAccountRoutes } from "./http/bearer.js";
import { requireSameOrigin } from "./http/csrf.js";
import { createFilesRouter } from "./files/routes.js";
import { UPLOAD_PATH, createUploadService } from "./files/uploads.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import { createSystemRouter } from "./system/routes.js";
import { createAlbumsRouter } from "./photos/albums.js";
import { createPhotosRouter } from "./photos/routes.js";
import type { MediaTools } from "./photos/tools.js";
import { createPublicShares } from "./shares/public.js";
import { createSharesRouter } from "./shares/routes.js";
import { createSearchRouter } from "./search/routes.js";

export interface AppOptions {
  config: Config;
  version: string;
  db: Db;
  /** Injectable clock (epoch ms) for rate limiting and session expiry. */
  now?: () => number;
  /** ffmpeg/ffprobe locations (default: found on PATH); `null` marks a tool as absent. */
  media?: Partial<MediaTools>;
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

export type CloudApp = express.Express & {
  /** Expire abandoned uploads; the server runs it hourly. */
  cleanUpUploads: () => Promise<void>;
};

export function createApp({ config, version, db, now = Date.now, media }: AppOptions): CloudApp {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Caddy

  const sessions = createSessionService({ db, config, now });

  const uploads = createUploadService({ db, config, now });
  const publicShares = createPublicShares({ db, config, now, uploads });

  app.use("/api", requireSameOrigin(config.publicOrigin));
  // tus owns its request bodies, so it is mounted before the JSON parser and without a mount
  // path (tus derives the upload ID from the full URL).
  app.all([UPLOAD_PATH, `${UPLOAD_PATH}/*rest`], sessions.requireUser, uploads.handler);
  app.all(
    ["/api/public/shares/:token/uploads", "/api/public/shares/:token/uploads/*rest"],
    publicShares.uploads,
  );
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", async (_req, res) => {
    const checks = { storage: await storageState(config.dataDir), database: databaseState(db) };
    const healthy = checks.storage === "ok" && checks.database === "ok";
    const body: HealthResponse = { status: healthy ? "ok" : "degraded", version, checks };
    res.status(healthy ? 200 : 503).json(body);
  });

  app.use(["/api/auth", "/api/admin"], rejectBearerOnAccountRoutes);
  app.use("/api/auth/passkeys", createPasskeyRouter({ db, config, sessions, now }));
  app.use("/api/auth/app-passwords", createAppPasswordRouter({ db, sessions, now }));
  app.use("/api/auth", createAuthRouter({ db, sessions, now }));
  app.use(
    "/api/admin/system",
    createSystemRouter({ sessions, dataDir: config.dataDir, version, now }),
  );
  app.use("/api/auth", createMfaRouter({ db, sessions, now }));
  app.use("/api/admin", createAdminRouter({ db, sessions, now }));
  app.use("/api/activity", createActivityRouter({ db, sessions }));
  app.use("/api", createPhotosRouter({ db, sessions, config, ...(media && { tools: media }) }));
  app.use("/api", createAlbumsRouter({ db, sessions, now }));
  app.use("/api/public/shares", publicShares.router);
  app.use("/api", createSharesRouter({ db, sessions, now }));
  app.use("/api/search", createSearchRouter({ db, sessions }));
  app.use("/api", createFilesRouter({ db, sessions, config, now }));
  app.use("/api", notFoundHandler);
  app.use(errorHandler);

  return Object.assign(app, { cleanUpUploads: uploads.cleanup });
}
