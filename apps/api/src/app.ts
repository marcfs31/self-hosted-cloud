import express from "express";
import type { HealthResponse } from "@cloud/shared";

export interface AppOptions {
  version: string;
}

export function createApp({ version }: AppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/api/health", (_req, res) => {
    const body: HealthResponse = { status: "ok", version };
    res.json(body);
  });

  return app;
}
