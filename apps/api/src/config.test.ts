import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const KEY = Buffer.alloc(32, 9).toString("base64");
const ENV = { DATA_DIR: "/data", PUBLIC_ORIGIN: "https://cloud.example.ts.net/", SECRET_KEY: KEY };

describe("loadConfig", () => {
  it("parses a complete environment", () => {
    expect(loadConfig({ ...ENV, PORT: "4001" })).toEqual({
      production: false,
      port: 4001,
      dataDir: "/data",
      publicOrigin: "https://cloud.example.ts.net",
      secretKey: Buffer.alloc(32, 9),
    });
  });

  it("fails loudly when DATA_DIR is missing", () => {
    expect(() => loadConfig({ PUBLIC_ORIGIN: "https://x.test", SECRET_KEY: KEY })).toThrow(
      /DATA_DIR/,
    );
  });

  it("fails loudly when SECRET_KEY is missing", () => {
    expect(() => loadConfig({ DATA_DIR: ENV.DATA_DIR, PUBLIC_ORIGIN: ENV.PUBLIC_ORIGIN })).toThrow(
      /SECRET_KEY/,
    );
  });

  it.each([
    ["too short", Buffer.alloc(16, 1).toString("base64")],
    ["too long", Buffer.alloc(33, 1).toString("base64")],
    ["not base64", "this is not a key, it has spaces and is long enough!!"],
    ["empty", ""],
  ])("rejects a SECRET_KEY that is %s, without echoing it", (_label, bad) => {
    let message = "";
    try {
      loadConfig({ ...ENV, SECRET_KEY: bad });
    } catch (e) {
      message = e instanceof Error ? e.message : "";
    }
    expect(message).toMatch(/SECRET_KEY/);
    expect(message).toMatch(/openssl rand -base64 32/);
    if (bad !== "") expect(message).not.toContain(bad);
  });
});
