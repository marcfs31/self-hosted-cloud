import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("parses a complete environment", () => {
    expect(
      loadConfig({
        DATA_DIR: "/data",
        PUBLIC_ORIGIN: "https://cloud.example.ts.net/",
        PORT: "4001",
      }),
    ).toEqual({
      production: false,
      port: 4001,
      dataDir: "/data",
      publicOrigin: "https://cloud.example.ts.net",
    });
  });

  it("fails loudly when DATA_DIR is missing", () => {
    expect(() => loadConfig({ PUBLIC_ORIGIN: "https://x.test" })).toThrow(/DATA_DIR/);
  });
});
