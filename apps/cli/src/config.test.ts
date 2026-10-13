import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configDir, deleteConfig, loadConfig, saveConfig } from "./config.js";

function io(env: Record<string, string>, home = "/home/me") {
  return { env, homeDir: home, cwd: "/work" };
}

describe("configDir", () => {
  it("prefers CLOUD_CONFIG_DIR, then XDG_CONFIG_HOME/cloud, then ~/.config/cloud", () => {
    expect(configDir(io({ CLOUD_CONFIG_DIR: "/x/y", XDG_CONFIG_HOME: "/xdg" }))).toBe("/x/y");
    expect(configDir(io({ XDG_CONFIG_HOME: "/xdg" }))).toBe("/xdg/cloud");
    expect(configDir(io({}))).toBe("/home/me/.config/cloud");
  });

  it("ignores empty values and resolves relative ones against the working directory", () => {
    expect(configDir(io({ CLOUD_CONFIG_DIR: "", XDG_CONFIG_HOME: "" }))).toBe(
      "/home/me/.config/cloud",
    );
    expect(configDir(io({ CLOUD_CONFIG_DIR: "rel" }))).toBe("/work/rel");
  });
});

describe("stored config", () => {
  it("round-trips with a private directory and file, and replaces an existing file", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "cloud-cfg-")), "nested", "cloud");
    const env = io({ CLOUD_CONFIG_DIR: dir });
    expect(await loadConfig(env)).toBeNull();
    await saveConfig(env, { server: "https://a", email: "a@b.c", token: "t1" });
    await saveConfig(env, { server: "https://a", email: "a@b.c", token: "t2" });
    expect(await loadConfig(env)).toEqual({ server: "https://a", email: "a@b.c", token: "t2" });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "config.json")).mode & 0o777).toBe(0o600);
    expect(await deleteConfig(env)).toBe(true);
    expect(await deleteConfig(env)).toBe(false);
    expect(await loadConfig(env)).toBeNull();
  });

  it("treats a damaged file as an error, not as logged out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cloud-cfg-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), '{"server": 1}');
    await expect(loadConfig(io({ CLOUD_CONFIG_DIR: dir }))).rejects.toThrow(/damaged/);
  });
});
