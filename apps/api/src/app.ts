import { access, constants } from "node:fs/promises";
import express from "express";
import type { HealthResponse } from "@cloud/shared";
import type { Config } from "./config.js";

export interface AppOptions {
  config: Config;
  version: string;
}

async function storageState(dataDir: string): Promise<"ok" | "unavailable"> {
  try {
    await access(dataDir, constants.W_OK);
    return "ok";
  } catch {
    return "unavailable";
  }
}

export function createApp({ config, version }: AppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/api/health", async (_req, res) => {
    const storage = await storageState(config.dataDir);
    const body: HealthResponse = {
      status: storage === "ok" ? "ok" : "degraded",
      version,
      checks: { storage },
    };
    res.status(body.status === "ok" ? 200 : 503).json(body);
  });

  return app;
}
