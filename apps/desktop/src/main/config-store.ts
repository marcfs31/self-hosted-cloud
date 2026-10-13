import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../sync/fsops.js";
import { parseStoredConfig, type ConfigDefaults, type StoredConfig } from "./config.js";

/** What Electron's safeStorage offers; injected so this module has no Electron import. */
export interface SecretCipher {
  /** False when the OS cannot encrypt (no keychain): nothing is then stored. */
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export class ConfigDamagedError extends Error {
  constructor(file: string) {
    super(`The settings file ${file} is damaged.`);
    this.name = "ConfigDamagedError";
  }
}

export class SecureStorageUnavailableError extends Error {
  constructor() {
    super("Secure storage is not available on this computer.");
    this.name = "SecureStorageUnavailableError";
  }
}

/** Unknown is a state: a password that exists but cannot be unlocked is not the same as none. */
export type PasswordResult =
  { state: "ok"; value: string } | { state: "missing" } | { state: "unreadable" };

/**
 * config.json holds everything except the secret; credentials.enc holds the app password
 * encrypted by the OS keychain (via safeStorage), base64 encoded.
 */
export class ConfigStore {
  readonly configFile: string;
  readonly credentialsFile: string;

  constructor(
    readonly dir: string,
    private readonly cipher: SecretCipher,
    private readonly defaults: ConfigDefaults,
  ) {
    this.configFile = join(dir, "config.json");
    this.credentialsFile = join(dir, "credentials.enc");
  }

  get secureStorage(): boolean {
    return this.cipher.isAvailable();
  }

  /** The saved settings, null on first run. A damaged file throws; it is never read as "first run". */
  async load(): Promise<StoredConfig | null> {
    let text: string;
    try {
      text = await readFile(this.configFile, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ConfigDamagedError(this.configFile);
    }
    const config = parseStoredConfig(parsed, this.defaults);
    if (config === undefined) throw new ConfigDamagedError(this.configFile);
    return config;
  }

  async hasPassword(): Promise<boolean> {
    return (await this.loadPassword()).state !== "missing";
  }

  async loadPassword(): Promise<PasswordResult> {
    let text: string;
    try {
      text = await readFile(this.credentialsFile, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" };
      throw err;
    }
    if (!this.cipher.isAvailable()) return { state: "unreadable" };
    try {
      return { state: "ok", value: this.cipher.decrypt(Buffer.from(text.trim(), "base64")) };
    } catch {
      return { state: "unreadable" };
    }
  }

  /**
   * Stores the password first, then the settings, so a crash between the two never leaves new
   * settings with an old secret. Refuses to store a password without secure storage.
   */
  async save(config: StoredConfig, password: string | undefined): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    if (password !== undefined) {
      if (!this.cipher.isAvailable()) throw new SecureStorageUnavailableError();
      await writeFileAtomic(this.credentialsFile, this.cipher.encrypt(password).toString("base64"));
    }
    await writeFileAtomic(this.configFile, `${JSON.stringify(config, null, 2)}\n`);
  }

  /** Forgets the secret (the settings stay). */
  async clearPassword(): Promise<void> {
    await rm(this.credentialsFile, { force: true });
  }
}
