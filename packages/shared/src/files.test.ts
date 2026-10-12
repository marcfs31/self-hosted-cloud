import { describe, expect, it } from "vitest";
import { fileName, uniqueName } from "./files.js";

describe("fileName", () => {
  it.each(["report.pdf", "Ünïcödé — notes", "a".repeat(255), ".env", "..hidden"])(
    "accepts %j",
    (name) => {
      expect(fileName.safeParse(name).success).toBe(true);
    },
  );

  it.each([
    "",
    ".",
    "..",
    "a/b",
    "../etc",
    "a\\b",
    "nul\u0000x",
    "tab\tx",
    " lead",
    "trail ",
    "a".repeat(256),
  ])("rejects %j", (name) => {
    expect(fileName.safeParse(name).success).toBe(false);
  });

  it("normalizes to NFC", () => {
    expect(fileName.parse("é")).toBe("é");
  });
});

describe("uniqueName", () => {
  it("keeps a free name", () => {
    expect(uniqueName("a.txt", new Set(["b.txt"]))).toBe("a.txt");
  });

  it("suffixes before the extension", () => {
    expect(uniqueName("a.txt", new Set(["a.txt", "a (1).txt"]))).toBe("a (2).txt");
  });

  it("suffixes names without an extension and dotfiles at the end", () => {
    expect(uniqueName("Photos", new Set(["Photos"]))).toBe("Photos (1)");
    expect(uniqueName(".env", new Set([".env"]))).toBe(".env (1)");
  });
});
