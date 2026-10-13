import { describe, expect, it } from "vitest";
import type { SettingsInput } from "../ipc/types.js";
import {
  parseSettingsInput,
  parseStoredConfig,
  validateSettings,
  type StoredConfig,
  type ValidationContext,
} from "./config.js";

const home = "/home/marc";
const defaults = { localFolder: "/home/marc/Cloud", deviceName: "pi-laptop" };

const input = (patch: Partial<SettingsInput> = {}): SettingsInput => ({
  server: "https://cloud.example.com",
  email: "Marc@Example.com",
  appPassword: "cloud_secret",
  localFolder: "/home/marc/Cloud",
  deviceName: "Laptop",
  launchAtLogin: true,
  ...patch,
});

const first: ValidationContext = { homeDir: home, previous: null, hasStoredPassword: false };

const saved: StoredConfig = {
  server: "https://cloud.example.com",
  email: "marc@example.com",
  localFolder: "/home/marc/Cloud",
  deviceName: "Laptop",
  launchAtLogin: false,
};
const later: ValidationContext = { homeDir: home, previous: saved, hasStoredPassword: true };

describe("validateSettings", () => {
  it("accepts a complete form and normalises it", () => {
    const result = validateSettings(
      input({ server: "cloud.example.com/", deviceName: "  Laptop " }),
      first,
    );
    expect(result).toEqual({
      ok: true,
      password: "cloud_secret",
      config: {
        server: "https://cloud.example.com",
        email: "marc@example.com",
        localFolder: "/home/marc/Cloud",
        deviceName: "Laptop",
        launchAtLogin: true,
      },
    });
  });

  it("requires the password on first save", () => {
    expect(validateSettings(input({ appPassword: "" }), first)).toEqual({
      ok: false,
      errors: [{ field: "appPassword", code: "password_required" }],
    });
  });

  it("keeps the stored password when the field is left empty and the account is unchanged", () => {
    const result = validateSettings(input({ appPassword: "", deviceName: "Desk" }), later);
    expect(result).toMatchObject({ ok: true, password: undefined });
  });

  it("requires a new password when the server or the email changes", () => {
    for (const patch of [{ server: "https://other.example.com" }, { email: "other@example.com" }]) {
      expect(validateSettings(input({ appPassword: "", ...patch }), later)).toEqual({
        ok: false,
        errors: [{ field: "appPassword", code: "password_required" }],
      });
    }
  });

  it("requires a password when the stored one is gone", () => {
    const lost = { ...later, hasStoredPassword: false };
    expect(validateSettings(input({ appPassword: "" }), lost)).toMatchObject({ ok: false });
  });

  it("reports every invalid field at once", () => {
    const result = validateSettings(
      input({
        server: "http://cloud.example.com",
        email: "nope",
        localFolder: "relative/dir",
        deviceName: "   ",
      }),
      first,
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "server", code: "server_insecure" },
        { field: "email", code: "email_invalid" },
        { field: "localFolder", code: "folder_not_absolute" },
        { field: "deviceName", code: "device_name_required" },
      ],
    });
  });

  it("refuses the home folder and a drive root as the sync folder", () => {
    for (const localFolder of [home, `${home}/`, "/"]) {
      expect(validateSettings(input({ localFolder }), first), localFolder).toEqual({
        ok: false,
        errors: [{ field: "localFolder", code: "folder_unsafe" }],
      });
    }
  });

  it("refuses an empty folder and an over-long or control-character device name", () => {
    expect(validateSettings(input({ localFolder: "" }), first)).toMatchObject({
      errors: [{ field: "localFolder", code: "folder_required" }],
    });
    expect(validateSettings(input({ deviceName: "x".repeat(65) }), first)).toMatchObject({
      errors: [{ field: "deviceName", code: "device_name_too_long" }],
    });
    expect(validateSettings(input({ deviceName: "bad\nname" }), first)).toMatchObject({
      errors: [{ field: "deviceName", code: "device_name_required" }],
    });
    expect(validateSettings(input({ deviceName: "x".repeat(64) }), first)).toMatchObject({
      ok: true,
    });
  });
});

describe("parseSettingsInput", () => {
  it("accepts a well-formed message", () => {
    expect(parseSettingsInput(input())).toEqual(input());
  });

  it("refuses anything else from the renderer", () => {
    expect(parseSettingsInput(null)).toBeUndefined();
    expect(parseSettingsInput("x")).toBeUndefined();
    expect(parseSettingsInput([])).toBeUndefined();
    expect(parseSettingsInput({ ...input(), launchAtLogin: "yes" })).toBeUndefined();
    expect(parseSettingsInput({ ...input(), server: 3 })).toBeUndefined();
    expect(parseSettingsInput({ ...input(), appPassword: "x".repeat(2000) })).toBeUndefined();
    const missing = Object.fromEntries(Object.entries(input()).filter(([key]) => key !== "email"));
    expect(parseSettingsInput(missing)).toBeUndefined();
  });

  it("drops fields it does not know", () => {
    expect(parseSettingsInput({ ...input(), extra: "x" })).toEqual(input());
  });
});

describe("parseStoredConfig", () => {
  it("loads a saved file that lacks newer fields with their defaults", () => {
    expect(
      parseStoredConfig(
        { server: "https://cloud.example.com", email: "a@b.co", localFolder: "/home/marc/Cloud" },
        defaults,
      ),
    ).toEqual({
      server: "https://cloud.example.com",
      email: "a@b.co",
      localFolder: "/home/marc/Cloud",
      deviceName: "pi-laptop",
      launchAtLogin: false,
    });
  });

  it("refuses a damaged core field instead of guessing", () => {
    expect(parseStoredConfig(null, defaults)).toBeUndefined();
    expect(
      parseStoredConfig(
        { server: "http://evil.example.com", email: "a", localFolder: "/x" },
        defaults,
      ),
    ).toBeUndefined();
    expect(
      parseStoredConfig(
        { server: "https://a.example.com", email: "a", localFolder: "rel" },
        defaults,
      ),
    ).toBeUndefined();
    expect(
      parseStoredConfig({ server: "https://a.example.com", localFolder: "/x" }, defaults),
    ).toBeUndefined();
  });
});
