import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, BadResponseError, NetworkError } from "../api/client.js";
import type { SettingsInput } from "../ipc/types.js";
import { ConfigStore, type SecretCipher } from "./config-store.js";
import { SettingsService, type AccountApi } from "./settings-service.js";

const cipher = (available = true): SecretCipher => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(`enc:${plain}`),
  decrypt: (data) => data.toString().replace(/^enc:/, ""),
});

let root: string;
let folder: string;
let store: ConfigStore;
let applied: number;
let loginItem: boolean[];
let calls: { server: string; token: string }[];
let me: () => Promise<{ email: string }>;
let service: SettingsService;

function build(secure = true): void {
  store = new ConfigStore(join(root, "config"), cipher(secure), {
    localFolder: join(root, "Cloud"),
    deviceName: "host",
  });
  service = new SettingsService({
    store,
    homeDir: join(root, "home"),
    defaults: { localFolder: join(root, "Cloud"), deviceName: "host" },
    createApi: (server, token): AccountApi => {
      calls.push({ server, token });
      return { me: () => me() };
    },
    setLaunchAtLogin: (enabled) => loginItem.push(enabled),
    applyConfig: () => {
      applied += 1;
      return Promise.resolve();
    },
  });
}

const form = (patch: Partial<SettingsInput> = {}): SettingsInput => ({
  server: "https://cloud.example.com",
  email: "marc@example.com",
  appPassword: "cloud_secret",
  localFolder: folder,
  deviceName: "Laptop",
  launchAtLogin: true,
  ...patch,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cloud-settings-"));
  folder = join(root, "Cloud");
  applied = 0;
  loginItem = [];
  calls = [];
  me = () => Promise.resolve({ email: "marc@example.com" });
  build();
});

describe("SettingsService.view", () => {
  it("offers the defaults on first run", async () => {
    expect(await service.view()).toEqual({
      server: "",
      email: "",
      hasAppPassword: false,
      localFolder: folder,
      deviceName: "host",
      launchAtLogin: false,
      secureStorage: true,
    });
  });

  it("never carries the password, only that one is saved", async () => {
    await service.save(form());
    const view = await service.view();
    expect(view.hasAppPassword).toBe(true);
    expect(JSON.stringify(view)).not.toContain("cloud_secret");
  });
});

describe("SettingsService.save", () => {
  it("creates the folder, stores the settings, sets login-at-startup and restarts syncing", async () => {
    const result = await service.save(form());
    expect(result).toMatchObject({ ok: true, config: { server: "https://cloud.example.com" } });
    expect(existsSync(folder)).toBe(true);
    expect(await store.load()).toMatchObject({ email: "marc@example.com", deviceName: "Laptop" });
    expect(await store.loadPassword()).toEqual({ state: "ok", value: "cloud_secret" });
    expect(loginItem).toEqual([true]);
    expect(applied).toBe(1);
  });

  it("refuses to store a password, and changes nothing, without secure storage", async () => {
    build(false);
    const result = await service.save(form());
    expect(result).toEqual({
      ok: false,
      errors: [{ field: "appPassword", code: "secure_storage_unavailable" }],
    });
    expect(await store.load()).toBeNull();
    expect(applied).toBe(0);
    expect(loginItem).toEqual([]);
    expect(existsSync(folder)).toBe(false);
  });

  it("returns field errors and saves nothing for an invalid form", async () => {
    const result = await service.save(form({ server: "http://cloud.example.com", email: "x" }));
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "server", code: "server_insecure" },
        { field: "email", code: "email_invalid" },
      ],
    });
    expect(await store.load()).toBeNull();
    expect(applied).toBe(0);
  });

  it("keeps the stored password when the field is empty and the account is unchanged", async () => {
    await service.save(form());
    const result = await service.save(form({ appPassword: "", deviceName: "Desk" }));
    expect(result.ok).toBe(true);
    expect(await store.loadPassword()).toEqual({ state: "ok", value: "cloud_secret" });
    expect((await store.load())?.deviceName).toBe("Desk");
  });

  it("asks for a new password when the server changes", async () => {
    await service.save(form());
    const result = await service.save(
      form({ appPassword: "", server: "https://other.example.com" }),
    );
    expect(result).toEqual({
      ok: false,
      errors: [{ field: "appPassword", code: "password_required" }],
    });
  });

  it("reports a folder that cannot be created", async () => {
    writeFileSync(join(root, "file"), "x");
    const result = await service.save(form({ localFolder: join(root, "file", "sub") }));
    expect(result).toEqual({
      ok: false,
      errors: [{ field: "localFolder", code: "folder_unusable" }],
    });
  });

  it("refuses a message that is not a settings form", async () => {
    for (const raw of [null, "x", { server: 1 }, { ...form(), launchAtLogin: "yes" }]) {
      expect(await service.save(raw)).toEqual({
        ok: false,
        errors: [{ field: "form", code: "invalid_input" }],
      });
    }
    expect(applied).toBe(0);
  });
});

describe("SettingsService.test (tri-state)", () => {
  it("ok when the app password belongs to the email entered", async () => {
    expect(await service.test(form())).toEqual({ result: "ok", email: "marc@example.com" });
    expect(calls).toEqual([{ server: "https://cloud.example.com", token: "cloud_secret" }]);
  });

  it("compares emails case-insensitively", async () => {
    me = () => Promise.resolve({ email: "marc@example.com" });
    expect(await service.test(form({ email: " Marc@Example.com " }))).toMatchObject({
      result: "ok",
    });
  });

  it("rejected when the server says the password is wrong", async () => {
    me = () => Promise.reject(new ApiError(401, "unauthenticated"));
    expect(await service.test(form())).toEqual({ result: "rejected", code: "unauthenticated" });
  });

  it("rejected when the password belongs to another account", async () => {
    me = () => Promise.resolve({ email: "someone@example.com" });
    expect(await service.test(form())).toEqual({
      result: "rejected",
      code: "email_mismatch",
      email: "someone@example.com",
    });
  });

  it("unavailable (not rejected) when the server cannot be reached or misbehaves", async () => {
    me = () => Promise.reject(new NetworkError("down"));
    expect(await service.test(form())).toEqual({ result: "unavailable", code: "network" });
    me = () => Promise.reject(new ApiError(502, undefined));
    expect(await service.test(form())).toEqual({ result: "unavailable", code: "server_error" });
    me = () => Promise.reject(new ApiError(429, "too_many_attempts"));
    expect(await service.test(form())).toEqual({ result: "unavailable", code: "server_error" });
    me = () => Promise.reject(new ApiError(404, undefined));
    expect(await service.test(form())).toEqual({ result: "unavailable", code: "bad_response" });
    me = () => Promise.reject(new BadResponseError());
    expect(await service.test(form())).toEqual({ result: "unavailable", code: "bad_response" });
  });

  it("invalid, without calling the server, when the form cannot be sent", async () => {
    expect(await service.test(form({ server: "ftp://x" }))).toEqual({
      result: "invalid",
      errors: [{ field: "server", code: "server_invalid" }],
    });
    expect(await service.test(form({ email: "x" }))).toMatchObject({ result: "invalid" });
    expect(await service.test(form({ appPassword: "" }))).toEqual({
      result: "invalid",
      errors: [{ field: "appPassword", code: "password_required" }],
    });
    expect(await service.test("junk")).toMatchObject({ result: "invalid" });
    expect(calls).toEqual([]);
  });

  it("uses the stored password only for the account it was saved for", async () => {
    await service.save(form());
    calls = [];
    expect(await service.test(form({ appPassword: "" }))).toMatchObject({ result: "ok" });
    expect(calls).toEqual([{ server: "https://cloud.example.com", token: "cloud_secret" }]);

    calls = [];
    const other = await service.test(
      form({ appPassword: "", server: "https://other.example.com" }),
    );
    expect(other).toMatchObject({ result: "invalid" });
    expect(calls).toEqual([]);
  });

  it("does not need a valid folder or device name to test", async () => {
    expect(await service.test(form({ localFolder: "", deviceName: "" }))).toMatchObject({
      result: "ok",
    });
  });
});
