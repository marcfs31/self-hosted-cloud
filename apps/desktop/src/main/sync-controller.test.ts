import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { EngineEvents, SyncStatus } from "../sync/index.js";
import { ConfigStore, type SecretCipher } from "./config-store.js";
import type { StoredConfig } from "./config.js";
import type { ShellStatus } from "./status.js";
import {
  stateFileFor,
  SyncController,
  type EngineHandle,
  type EngineSettings,
} from "./sync-controller.js";

class FakeEngine extends EventEmitter<EngineEvents> implements EngineHandle {
  status: SyncStatus = { state: "idle" };
  started = false;
  stopped = false;
  constructor(readonly settings: EngineSettings) {
    super();
  }
  start(): void {
    this.started = true;
  }
  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }
  pause(): void {
    this.set({ state: "paused" });
  }
  resume(): void {
    this.set({ state: "idle" });
  }
  set(status: SyncStatus): void {
    this.status = status;
    this.emit("status", status);
  }
}

const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`enc:${plain}`),
  decrypt: (data) => data.toString().replace(/^enc:/, ""),
};

const config: StoredConfig = {
  server: "https://cloud.example.com",
  email: "marc@example.com",
  localFolder: "/home/marc/Cloud",
  deviceName: "Laptop",
  launchAtLogin: false,
};

let dir: string;
let store: ConfigStore;
let engines: FakeEngine[];
let controller: SyncController;
let seen: ShellStatus[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cloud-controller-"));
  store = new ConfigStore(dir, cipher, { localFolder: "/x", deviceName: "host" });
  engines = [];
  seen = [];
  controller = new SyncController({
    store,
    syncDir: join(dir, "sync"),
    createEngine: (settings) => {
      const engine = new FakeEngine(settings);
      engines.push(engine);
      return engine;
    },
  });
  controller.on("status", (s) => seen.push(s));
});

describe("SyncController", () => {
  it("is unconfigured, and creates no engine, on first run", async () => {
    await controller.apply();
    expect(controller.status).toEqual({ state: "unconfigured", active: 0 });
    expect(engines).toHaveLength(0);
  });

  it("is unconfigured when the settings exist but the password does not", async () => {
    await store.save(config, undefined);
    await controller.apply();
    expect(controller.status.state).toBe("unconfigured");
    expect(controller.config).toEqual(config);
    expect(engines).toHaveLength(0);
  });

  it("starts an engine with the saved settings and the decrypted password", async () => {
    await store.save(config, "cloud_secret");
    await controller.apply();
    expect(engines).toHaveLength(1);
    const [engine] = engines;
    expect(engine?.started).toBe(true);
    expect(engine?.settings).toMatchObject({
      server: config.server,
      token: "cloud_secret",
      localRoot: config.localFolder,
      deviceName: "Laptop",
    });
    expect(engine?.settings.stateFile).toBe(stateFileFor(join(dir, "sync"), config));
    expect(controller.status).toEqual({ state: "syncing", active: 0 });
  });

  it("forwards engine status, with the error code", async () => {
    await store.save(config, "cloud_secret");
    await controller.apply();
    engines[0]?.set({ state: "idle" });
    expect(controller.status).toEqual({ state: "idle", active: 0 });
    engines[0]?.set({ state: "error", code: "unauthenticated" });
    expect(controller.status).toEqual({ state: "error", code: "unauthenticated", active: 0 });
    engines[0]?.set({ state: "offline" });
    expect(controller.status).toEqual({ state: "offline", active: 0 });
  });

  it("counts uploads and downloads in flight while syncing", async () => {
    await store.save(config, "cloud_secret");
    await controller.apply();
    const engine = engines[0];
    engine?.set({ state: "syncing" });
    engine?.emit("activity", { type: "upload", path: "a", phase: "start" });
    engine?.emit("activity", { type: "download", path: "b", phase: "start" });
    engine?.emit("activity", { type: "rename-remote", path: "c", phase: "start" });
    expect(controller.status).toEqual({ state: "syncing", active: 2 });
    engine?.emit("activity", { type: "upload", path: "a", phase: "done" });
    expect(controller.status.active).toBe(1);
    engine?.emit("activity", { type: "download", path: "b", phase: "failed", code: "EACCES" });
    expect(controller.status.active).toBe(0);
    engine?.set({ state: "idle" });
    expect(controller.status).toEqual({ state: "idle", active: 0 });
  });

  it("passes engine activity on to listeners", async () => {
    await store.save(config, "cloud_secret");
    await controller.apply();
    const got: string[] = [];
    controller.on("activity", (a) => got.push(`${a.type}:${a.phase}`));
    engines[0]?.emit("activity", { type: "conflict", path: "a", phase: "done" });
    expect(got).toEqual(["conflict:done"]);
  });

  it("pauses and resumes the engine, and keeps the pause across a settings change", async () => {
    await store.save(config, "cloud_secret");
    await controller.apply();
    controller.togglePause();
    expect(controller.status.state).toBe("paused");
    await controller.apply();
    expect(engines).toHaveLength(2);
    expect(controller.status.state).toBe("paused");
    controller.togglePause();
    expect(controller.status.state).toBe("idle");
  });

  it("stops the old engine when settings are applied again", async () => {
    await store.save(config, "cloud_secret");
    await controller.apply();
    await store.save({ ...config, localFolder: "/home/marc/Other" }, undefined);
    await controller.apply();
    expect(engines[0]?.stopped).toBe(true);
    expect(engines[1]?.started).toBe(true);
    expect(engines[1]?.settings.stateFile).not.toBe(engines[0]?.settings.stateFile);
    // events from the stopped engine no longer reach the status
    engines[0]?.set({ state: "error", code: "x" });
    expect(controller.status.state).toBe("syncing");
  });

  it("stops the engine and reports an error when the settings file becomes unreadable", async () => {
    await store.save(config, "cloud_secret");
    await controller.apply();
    writeFileSync(store.configFile, "");
    await controller.apply();
    expect(engines[0]?.stopped).toBe(true);
    expect(controller.status).toEqual({ state: "error", code: "config_damaged", active: 0 });
  });

  it("reports a password that cannot be unlocked as an error, not as unconfigured", async () => {
    await store.save(config, "cloud_secret");
    cipher.decrypt = () => {
      throw new Error("keychain changed");
    };
    try {
      await controller.apply();
    } finally {
      cipher.decrypt = (data) => data.toString().replace(/^enc:/, "");
    }
    expect(controller.status).toEqual({
      state: "error",
      code: "credentials_unreadable",
      active: 0,
    });
    expect(engines).toHaveLength(0);
  });

  it("stop() stops the running engine", async () => {
    await store.save(config, "cloud_secret");
    await controller.apply();
    await controller.stop();
    expect(engines[0]?.stopped).toBe(true);
  });
});

describe("stateFileFor", () => {
  it("differs per server, account and folder, and is stable", () => {
    const base = stateFileFor("/s", config);
    expect(stateFileFor("/s", config)).toBe(base);
    expect(stateFileFor("/s", { ...config, localFolder: "/other" })).not.toBe(base);
    expect(stateFileFor("/s", { ...config, email: "x@example.com" })).not.toBe(base);
    expect(stateFileFor("/s", { ...config, server: "https://b.example.com" })).not.toBe(base);
    const renamed: StoredConfig = { ...config, deviceName: "Other" };
    expect(stateFileFor("/s", renamed)).toBe(base);
  });
});
