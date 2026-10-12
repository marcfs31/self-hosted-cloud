import { z } from "zod";

export const healthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponse>;
