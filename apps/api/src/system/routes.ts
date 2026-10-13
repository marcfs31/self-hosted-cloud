import { Router } from "express";
import type { SystemStatus } from "@cloud/shared";
import type { SessionService } from "../auth/sessions.js";
import { defaultProbes, readSystemStatus, type SystemProbes } from "./status.js";

export function createSystemRouter(opts: {
  sessions: SessionService;
  dataDir: string;
  version: string;
  now: () => number;
  /** Tests replace the machine readers; production uses the real ones. */
  probes?: SystemProbes;
}): Router {
  const { sessions, dataDir, version, now } = opts;
  const probes = opts.probes ?? defaultProbes(now);
  const router = Router();
  router.use(sessions.requireUser, sessions.requireRole("admin"));

  router.get("/", async (_req, res) => {
    const body: SystemStatus = await readSystemStatus(probes, { dataDir, version });
    res.json(body);
  });

  return router;
}
