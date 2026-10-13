import { isAbsolute, normalize, parse, resolve } from "node:path";
import { emailField } from "@cloud/shared";
import type { FieldError, SettingsInput } from "../ipc/types.js";
import { normalizeServer } from "./server-url.js";

/** What is saved in config.json. The app password is stored separately, encrypted. */
export interface StoredConfig {
  server: string;
  email: string;
  localFolder: string;
  deviceName: string;
  launchAtLogin: boolean;
}

export interface ConfigDefaults {
  localFolder: string;
  deviceName: string;
}

export const MAX_DEVICE_NAME = 64;
export const MAX_PASSWORD = 1024;

const isControl = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The renderer is untrusted: its message is checked field by field before anything uses it. */
export function parseSettingsInput(raw: unknown): SettingsInput | undefined {
  if (!isRecord(raw)) return undefined;
  const { server, email, appPassword, localFolder, deviceName, launchAtLogin } = raw;
  if (
    typeof server !== "string" ||
    typeof email !== "string" ||
    typeof appPassword !== "string" ||
    typeof localFolder !== "string" ||
    typeof deviceName !== "string" ||
    typeof launchAtLogin !== "boolean"
  ) {
    return undefined;
  }
  if ([server, email, localFolder, deviceName].some((s) => s.length > 4096)) return undefined;
  if (appPassword.length > MAX_PASSWORD) return undefined;
  return { server, email, appPassword, localFolder, deviceName, launchAtLogin };
}

/** A saved file missing a newer field loads with its default; a missing or invalid core field is "no config". */
export function parseStoredConfig(
  raw: unknown,
  defaults: ConfigDefaults,
): StoredConfig | undefined {
  if (!isRecord(raw)) return undefined;
  const { server, email, localFolder, deviceName, launchAtLogin } = raw;
  if (typeof server !== "string" || typeof email !== "string") return undefined;
  const origin = normalizeServer(server);
  if (!origin.ok) return undefined;
  if (typeof localFolder !== "string" || !isAbsolute(localFolder)) return undefined;
  return {
    server: origin.origin,
    email,
    localFolder,
    deviceName:
      typeof deviceName === "string" && deviceName.trim() !== "" ? deviceName : defaults.deviceName,
    launchAtLogin: typeof launchAtLogin === "boolean" ? launchAtLogin : false,
  };
}

/** Folders that must never be a sync root: a drive root or the home folder itself. */
export function folderProblem(folder: string, homeDir: string): "folder_unsafe" | undefined {
  const full = resolve(folder);
  if (parse(full).root === full) return "folder_unsafe";
  if (full === resolve(homeDir)) return "folder_unsafe";
  return undefined;
}

export interface ValidationContext {
  homeDir: string;
  /** What is saved now, or null on first run. */
  previous: StoredConfig | null;
  hasStoredPassword: boolean;
}

export type Validation =
  | { ok: true; config: StoredConfig; password: string | undefined }
  | { ok: false; errors: FieldError[] };

/**
 * Checks the form and returns the config to store. The app password is tied to one server and
 * account, so a new one is required on first save and whenever the server or email changes.
 */
export function validateSettings(input: SettingsInput, context: ValidationContext): Validation {
  const errors: FieldError[] = [];

  const server = normalizeServer(input.server);
  if (!server.ok) errors.push({ field: "server", code: server.code });

  const email = emailField.safeParse(input.email.trim());
  if (!email.success) errors.push({ field: "email", code: "email_invalid" });

  const folderText = input.localFolder.trim();
  let localFolder = "";
  if (folderText === "") {
    errors.push({ field: "localFolder", code: "folder_required" });
  } else if (!isAbsolute(folderText)) {
    errors.push({ field: "localFolder", code: "folder_not_absolute" });
  } else {
    localFolder = normalize(resolve(folderText));
    const problem = folderProblem(localFolder, context.homeDir);
    if (problem !== undefined) errors.push({ field: "localFolder", code: problem });
  }

  const deviceName = input.deviceName.trim();
  if (deviceName === "" || Array.from(deviceName).some(isControl)) {
    errors.push({ field: "deviceName", code: "device_name_required" });
  } else if (Array.from(deviceName).length > MAX_DEVICE_NAME) {
    errors.push({ field: "deviceName", code: "device_name_too_long" });
  }

  if (!server.ok || !email.success) return { ok: false, errors };

  const accountChanged =
    context.previous === null ||
    context.previous.server !== server.origin ||
    context.previous.email !== email.data;
  const password = input.appPassword === "" ? undefined : input.appPassword;
  if (password === undefined && (accountChanged || !context.hasStoredPassword)) {
    errors.push({ field: "appPassword", code: "password_required" });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    password,
    config: {
      server: server.origin,
      email: email.data,
      localFolder,
      deviceName,
      launchAtLogin: input.launchAtLogin,
    },
  };
}
