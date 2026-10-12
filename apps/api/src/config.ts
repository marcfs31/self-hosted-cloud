import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATA_DIR: z.string().min(1),
  PUBLIC_ORIGIN: z.url(),
});

export type Config = {
  production: boolean;
  port: number;
  dataDir: string;
  publicOrigin: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    production: e.NODE_ENV === "production",
    port: e.PORT,
    dataDir: e.DATA_DIR,
    publicOrigin: new URL(e.PUBLIC_ORIGIN).origin,
  };
}
