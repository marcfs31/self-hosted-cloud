import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ConfigDamagedError,
  ConfigStore,
  SecureStorageUnavailableError,
  type SecretCipher,
} from "./config-store.js";
import type { StoredConfig } from "./config.js";

/** A reversible fake: "encrypted" bytes are the reversed text plus a marker, so plaintext never appears on disk. */
function fakeCipher(available = true): SecretCipher & { available: boolean } {
  const cipher = {
    available,
    isAvailable: () => cipher.available,
    encrypt: (plain: string) => Buffer.from(`${Array.from(plain).reverse().join("")}-`),
    decrypt: (data: Buffer) => {
      const text = data.toString();
      if (!text.endsWith("-")) throw new Error("bad data");
      return Array.from(text.slice(0, -1)).reverse().join("");
    },
  };
  return cipher;
}

const config: StoredConfig = {
  server: "https://cloud.example.com",
  email: "marc@example.com",
  localFolder: "/home/marc/Cloud",
  deviceName: "Laptop",
  launchAtLogin: false,
};
const defaults = { localFolder: "/home/marc/Cloud", deviceName: "host" };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cloud-config-"));
});

describe("ConfigStore", () => {
  it("is empty on first run", async () => {
    const store = new ConfigStore(dir, fakeCipher(), defaults);
    expect(await store.load()).toBeNull();
    expect(await store.loadPassword()).toEqual({ state: "missing" });
    expect(await store.hasPassword()).toBe(false);
  });

  it("saves settings and an encrypted password, and the plaintext never reaches the disk", async () => {
    const store = new ConfigStore(dir, fakeCipher(), defaults);
    await store.save(config, "cloud_secret");

    expect(await store.load()).toEqual(config);
    expect(await store.loadPassword()).toEqual({ state: "ok", value: "cloud_secret" });
    for (const file of [store.configFile, store.credentialsFile]) {
      expect(readFileSync(file, "utf8")).not.toContain("cloud_secret");
    }
  });

  it("keeps the stored password when saving without a new one", async () => {
    const cipher = fakeCipher();
    const store = new ConfigStore(dir, cipher, defaults);
    await store.save(config, "cloud_secret");
    await store.save({ ...config, deviceName: "Desk" }, undefined);
    expect((await store.load())?.deviceName).toBe("Desk");
    expect(await store.loadPassword()).toEqual({ state: "ok", value: "cloud_secret" });
  });

  it("refuses to store a password when secure storage is unavailable, and writes nothing", async () => {
    const store = new ConfigStore(dir, fakeCipher(false), defaults);
    await expect(store.save(config, "cloud_secret")).rejects.toBeInstanceOf(
      SecureStorageUnavailableError,
    );
    expect(await store.load()).toBeNull();
    expect(await store.loadPassword()).toEqual({ state: "missing" });
  });

  it("can save settings without a password even when secure storage is unavailable", async () => {
    const store = new ConfigStore(dir, fakeCipher(false), defaults);
    await store.save(config, undefined);
    expect(await store.load()).toEqual(config);
  });

  it("reports a password it cannot unlock as unreadable, not as missing", async () => {
    const cipher = fakeCipher();
    const store = new ConfigStore(dir, cipher, defaults);
    writeFileSync(store.credentialsFile, Buffer.from("garbage").toString("base64"));
    expect(await store.loadPassword()).toEqual({ state: "unreadable" });
    cipher.available = false;
    expect(await store.loadPassword()).toEqual({ state: "unreadable" });
  });

  it("throws on a damaged settings file instead of treating it as first run", async () => {
    const store = new ConfigStore(dir, fakeCipher(), defaults);
    writeFileSync(store.configFile, "{ not json");
    await expect(store.load()).rejects.toBeInstanceOf(ConfigDamagedError);
    writeFileSync(store.configFile, JSON.stringify({ server: "http://insecure.example.com" }));
    await expect(store.load()).rejects.toBeInstanceOf(ConfigDamagedError);
  });

  it("clearPassword forgets the secret only", async () => {
    const cipher = fakeCipher();
    const store = new ConfigStore(dir, cipher, defaults);
    await store.save(config, "cloud_secret");
    await store.clearPassword();
    expect(await store.loadPassword()).toEqual({ state: "missing" });
    expect(await store.load()).toEqual(config);
  });
});
