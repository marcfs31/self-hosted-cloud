import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CliError, usageError } from "./errors.js";
import type { Io } from "./io.js";

export interface StoredConfig {
  server: string;
  email: string;
  token: string;
}

type ConfigEnv = Pick<Io, "env" | "homeDir" | "cwd">;

/** $CLOUD_CONFIG_DIR, else $XDG_CONFIG_HOME/cloud, else ~/.config/cloud. */
export function configDir(io: ConfigEnv): string {
  const explicit = io.env.CLOUD_CONFIG_DIR;
  if (explicit !== undefined && explicit !== "") return resolve(io.cwd, explicit);
  const xdg = io.env.XDG_CONFIG_HOME;
  if (xdg !== undefined && xdg !== "") return resolve(io.cwd, xdg, "cloud");
  return join(io.homeDir, ".config", "cloud");
}

export function configFile(io: ConfigEnv): string {
  return join(configDir(io), "config.json");
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The app password travels in every request, so plain http is only allowed to this machine.
 * Throws a usage error (exit 1) for any other http:// address.
 */
export function assertSecureServer(server: string): void {
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    throw usageError(`Not a valid server address: ${server}`);
  }
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
    throw usageError(
      `Refusing to use ${server}: the app password would cross the network unencrypted. ` +
        `Use an https:// address (plain http:// is only allowed for localhost, 127.0.0.1 and [::1]).`,
    );
  }
}

function isStoredConfig(value: unknown): value is StoredConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.server === "string" && typeof v.email === "string" && typeof v.token === "string";
}

/** The stored login, or null when there is none. A damaged file is an error, never "logged out". */
export async function loadConfig(io: ConfigEnv): Promise<StoredConfig | null> {
  const file = configFile(io);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!isStoredConfig(parsed)) {
    throw new CliError(`The configuration file ${file} is damaged. Run 'cloud login' again.`);
  }
  assertSecureServer(parsed.server);
  return { server: parsed.server, email: parsed.email, token: parsed.token };
}

/** Directory 0700, file 0600, replaced atomically so a crash never leaves half a token. */
export async function saveConfig(io: ConfigEnv, config: StoredConfig): Promise<void> {
  const dir = configDir(io);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const file = configFile(io);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
}

/** True when a stored login was removed (a damaged file is removed too). */
export async function deleteConfig(io: ConfigEnv): Promise<boolean> {
  const file = configFile(io);
  try {
    await rm(file);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
