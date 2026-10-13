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

  it("never exceeds 255 characters: shortens the stem and keeps the extension", () => {
    const name = `${"a".repeat(251)}.txt`;
    const taken = new Set([name]);
    const out = uniqueName(name, taken);
    expect(out).toBe(`${"a".repeat(247)} (1).txt`);
    expect(out).toHaveLength(255);
    expect(fileName.safeParse(out).success).toBe(true);
    taken.add(out);
    const next = uniqueName(name, taken);
    expect(next).toBe(`${"a".repeat(247)} (2).txt`);
  });

  it("keeps the suffix at the end of a long name without an extension", () => {
    const name = "b".repeat(255);
    const out = uniqueName(name, new Set([name]));
    expect(out).toBe(`${"b".repeat(251)} (1)`);
    expect(out).toHaveLength(255);
  });

  it("stays within 255 characters for two-digit and larger counters", () => {
    const name = `${"c".repeat(250)}.md`;
    const taken = new Set([name]);
    for (let i = 0; i < 120; i++) taken.add(uniqueName(name, taken));
    const out = uniqueName(name, taken);
    expect(out.length).toBeLessThanOrEqual(255);
    expect(out.endsWith(" (121).md")).toBe(true);
    expect(taken.has(out)).toBe(false);
  });

  it("gives up the extension when it alone would not leave room for a stem", () => {
    const name = `a.${"x".repeat(253)}`;
    const out = uniqueName(name, new Set([name]));
    expect(out.length).toBeLessThanOrEqual(255);
    expect(out).not.toBe(name);
    expect(out.endsWith(" (1)")).toBe(true);
    expect(fileName.safeParse(out).success).toBe(true);
  });

  it("keeps a long extension when at least one stem character still fits", () => {
    const name = `a.${"x".repeat(240)}`;
    const out = uniqueName(name, new Set([name]));
    expect(out).toBe(`a (1).${"x".repeat(240)}`);
    expect(out.length).toBeLessThanOrEqual(255);
  });

  it("never splits a surrogate pair when shortening", () => {
    // 250 units of emoji + ".txt" = 254; room for the stem is 255 - 4 - 4 = 247, an odd cut.
    const name = `${"😀".repeat(125)}.txt`;
    expect(name).toHaveLength(254);
    const out = uniqueName(name, new Set([name]));
    expect(out).toBe(`${"😀".repeat(123)} (1).txt`);
    expect(out.length).toBeLessThanOrEqual(255);
    expect(/\p{Surrogate}/u.test(out)).toBe(false);
  });

  it("counts characters like fileName does, so a result is always a valid name", () => {
    const name = `${"é".repeat(120)}${"😀".repeat(65)}.tar.gz`;
    expect(fileName.safeParse(name).success).toBe(true);
    const taken = new Set([name]);
    for (let i = 0; i < 12; i++) {
      const out = uniqueName(name, taken);
      expect(fileName.safeParse(out).success, out).toBe(true);
      expect(/\p{Surrogate}/u.test(out)).toBe(false);
      expect(out.endsWith(".gz")).toBe(true);
      taken.add(out);
    }
  });
});
