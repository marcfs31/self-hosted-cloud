import type { Dictionary } from "../i18n/en.js";

/*
 * The contract between the settings window (renderer) and the main process. Types only, and no
 * imports beyond the dictionary type: the renderer program type-checks against this file.
 */

/** Channel names. The preload (a single sandboxed file) repeats them as literals checked against this union. */
export type Channel =
  | "settings:get-state"
  | "settings:save"
  | "settings:choose-folder"
  | "settings:test-connection"
  | "status:changed";

export type StatusState = "unconfigured" | "idle" | "syncing" | "paused" | "error" | "offline";

export interface StatusView {
  state: StatusState;
  /** The translated status line, as shown in the tray. */
  label: string;
}

/** What the form submits. An empty appPassword means "keep the stored one". */
export interface SettingsInput {
  server: string;
  email: string;
  appPassword: string;
  localFolder: string;
  deviceName: string;
  launchAtLogin: boolean;
}

/** What the form shows. The app password is never sent back to the renderer. */
export interface SettingsView {
  server: string;
  email: string;
  hasAppPassword: boolean;
  localFolder: string;
  deviceName: string;
  launchAtLogin: boolean;
  /** False when the OS cannot encrypt secrets: the password then cannot be stored. */
  secureStorage: boolean;
}

export type ValidationCode =
  | "invalid_input"
  | "server_required"
  | "server_invalid"
  | "server_insecure"
  | "email_invalid"
  | "password_required"
  | "secure_storage_unavailable"
  | "folder_required"
  | "folder_not_absolute"
  | "folder_unsafe"
  | "folder_unusable"
  | "device_name_required"
  | "device_name_too_long"
  | "save_failed";

export type FieldName = keyof SettingsInput | "form";

export interface FieldError {
  field: FieldName;
  code: ValidationCode;
}

export type SaveResult = { ok: true; config: SettingsView } | { ok: false; errors: FieldError[] };

/** Unknown is a state: "could not check" is never reported as "rejected". */
export type TestOutcome =
  | { result: "ok"; email: string }
  | { result: "rejected"; code: "unauthenticated" | "email_mismatch"; email?: string }
  | { result: "unavailable"; code: "network" | "server_error" | "bad_response" }
  | { result: "invalid"; errors: FieldError[] };

export interface InitialState {
  locale: string;
  strings: Dictionary["settings"];
  config: SettingsView;
  status: StatusView;
}

/** What the preload exposes as window.desktop. */
export interface DesktopApi {
  getState(): Promise<InitialState>;
  saveConfig(input: SettingsInput): Promise<SaveResult>;
  /** The chosen folder, or null when the dialog was cancelled. */
  chooseFolder(): Promise<string | null>;
  testConnection(input: SettingsInput): Promise<TestOutcome>;
  /** Returns the function that unsubscribes. */
  onStatus(listener: (status: StatusView) => void): () => void;
}
