import { mkdir, stat } from "node:fs/promises";
import { ApiError, BadResponseError, NetworkError } from "../api/client.js";
import { emailField } from "@cloud/shared";
import type { FieldError, SaveResult, SettingsView, TestOutcome } from "../ipc/types.js";
import {
  ConfigDamagedError,
  SecureStorageUnavailableError,
  type ConfigStore,
} from "./config-store.js";
import {
  parseSettingsInput,
  validateSettings,
  type ConfigDefaults,
  type StoredConfig,
} from "./config.js";
import { normalizeServer } from "./server-url.js";

/** What a connection test needs from the server. */
export interface AccountApi {
  me(): Promise<{ email: string }>;
}

export interface SettingsDeps {
  store: ConfigStore;
  homeDir: string;
  defaults: ConfigDefaults;
  createApi(server: string, token: string): AccountApi;
  setLaunchAtLogin(enabled: boolean): void;
  /** Restarts syncing with what was just saved. */
  applyConfig(): Promise<void>;
}

const INVALID: FieldError[] = [{ field: "form", code: "invalid_input" }];

/** The settings window's back end: validates what the untrusted renderer sends and persists it. */
export class SettingsService {
  constructor(private readonly deps: SettingsDeps) {}

  private async loadConfig(): Promise<StoredConfig | null> {
    try {
      return await this.deps.store.load();
    } catch (err) {
      if (err instanceof ConfigDamagedError) return null; // the form then offers the defaults
      throw err;
    }
  }

  async view(): Promise<SettingsView> {
    const config = await this.loadConfig();
    const password = await this.deps.store.loadPassword();
    return {
      server: config?.server ?? "",
      email: config?.email ?? "",
      hasAppPassword: password.state === "ok",
      localFolder: config?.localFolder ?? this.deps.defaults.localFolder,
      deviceName: config?.deviceName ?? this.deps.defaults.deviceName,
      launchAtLogin: config?.launchAtLogin ?? false,
      secureStorage: this.deps.store.secureStorage,
    };
  }

  async save(raw: unknown): Promise<SaveResult> {
    const input = parseSettingsInput(raw);
    if (input === undefined) return { ok: false, errors: INVALID };

    const previous = await this.loadConfig();
    const stored = await this.deps.store.loadPassword();
    const checked = validateSettings(input, {
      homeDir: this.deps.homeDir,
      previous,
      hasStoredPassword: stored.state === "ok",
    });
    if (!checked.ok) return checked;
    if (checked.password !== undefined && !this.deps.store.secureStorage) {
      return { ok: false, errors: [{ field: "appPassword", code: "secure_storage_unavailable" }] };
    }

    try {
      await mkdir(checked.config.localFolder, { recursive: true });
      if (!(await stat(checked.config.localFolder)).isDirectory())
        throw new Error("not a directory");
    } catch {
      return { ok: false, errors: [{ field: "localFolder", code: "folder_unusable" }] };
    }

    try {
      await this.deps.store.save(checked.config, checked.password);
    } catch (err) {
      if (err instanceof SecureStorageUnavailableError) {
        return {
          ok: false,
          errors: [{ field: "appPassword", code: "secure_storage_unavailable" }],
        };
      }
      return { ok: false, errors: [{ field: "form", code: "save_failed" }] };
    }
    this.deps.setLaunchAtLogin(checked.config.launchAtLogin);
    await this.deps.applyConfig();
    return { ok: true, config: await this.view() };
  }

  /** Asks the server who the app password belongs to. Only server, email and password matter here. */
  async test(raw: unknown): Promise<TestOutcome> {
    const input = parseSettingsInput(raw);
    if (input === undefined) return { result: "invalid", errors: INVALID };

    const errors: FieldError[] = [];
    const server = normalizeServer(input.server);
    if (!server.ok) errors.push({ field: "server", code: server.code });
    const email = emailField.safeParse(input.email.trim());
    if (!email.success) errors.push({ field: "email", code: "email_invalid" });
    if (!server.ok || !email.success) return { result: "invalid", errors };

    // A stored password only stands in when the server and account are the ones it was saved for.
    const previous = await this.loadConfig();
    const stored = await this.deps.store.loadPassword();
    const sameAccount = previous?.server === server.origin && previous.email === email.data;
    const token =
      input.appPassword !== ""
        ? input.appPassword
        : sameAccount && stored.state === "ok"
          ? stored.value
          : undefined;
    if (token === undefined) {
      return { result: "invalid", errors: [{ field: "appPassword", code: "password_required" }] };
    }

    try {
      const me = await this.deps.createApi(server.origin, token).me();
      if (me.email.toLowerCase() !== email.data) {
        return { result: "rejected", code: "email_mismatch", email: me.email };
      }
      return { result: "ok", email: me.email };
    } catch (err) {
      return outcomeOf(err);
    }
  }
}

function outcomeOf(err: unknown): TestOutcome {
  if (err instanceof NetworkError) return { result: "unavailable", code: "network" };
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403)
      return { result: "rejected", code: "unauthenticated" };
    if (err.status >= 500 || err.status === 429)
      return { result: "unavailable", code: "server_error" };
    return { result: "unavailable", code: "bad_response" };
  }
  if (err instanceof BadResponseError) return { result: "unavailable", code: "bad_response" };
  return { result: "unavailable", code: "network" };
}
