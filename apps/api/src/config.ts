import { z } from "zod";

const KEY_BYTES = 32;

/** Canonical base64 of exactly 32 bytes, as `openssl rand -base64 32` prints it. */
const secretKeyField = z.string().refine((value) => {
  const bytes = Buffer.from(value, "base64");
  return bytes.length === KEY_BYTES && bytes.toString("base64") === value;
}, "must be 32 random bytes, base64-encoded (generate one with: openssl rand -base64 32)");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATA_DIR: z.string().min(1),
  PUBLIC_ORIGIN: z.url(),
  SECRET_KEY: secretKeyField,
});

export type Config = {
  production: boolean;
  port: number;
  dataDir: string;
  publicOrigin: string;
  /** AES-256 key (32 bytes) that seals secrets stored in the database, such as TOTP seeds. */
  secretKey: Buffer;
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
    secretKey: Buffer.from(e.SECRET_KEY, "base64"),
  };
}
