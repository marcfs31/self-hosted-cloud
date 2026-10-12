import { z } from "zod";

export const checkState = z.enum(["ok", "unavailable"]);

export const healthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  checks: z.object({
    storage: checkState,
  }),
});
export type HealthResponse = z.infer<typeof healthResponse>;
