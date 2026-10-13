import { describe, expect, it } from "vitest";
import { formatBytes, formatDate, parseGiB, toGiBInput } from "./format";

const GIB = 1024 ** 3;

describe("formatBytes", () => {
  it("uses binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(1.5 * GIB)).toBe("1.5 GiB");
    expect(formatBytes(100 * GIB)).toBe("100 GiB");
    expect(formatBytes(2 * 1024 * GIB)).toBe("2 TiB");
  });

  it("does not show 1024 of a smaller unit", () => {
    expect(formatBytes(1024 ** 2 - 1)).toBe("1 MiB");
  });

  it("treats negative and non-finite input as zero", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });
});

describe("parseGiB", () => {
  it("parses whole and decimal GiB into bytes", () => {
    expect(parseGiB("100")).toBe(100 * GIB);
    expect(parseGiB(" 1.5 ")).toBe(1.5 * GIB);
    expect(parseGiB("0")).toBe(0);
    expect(parseGiB("0,5")).toBe(0.5 * GIB);
  });

  it("returns whole bytes", () => {
    expect(Number.isInteger(parseGiB("0.3333333"))).toBe(true);
  });

  it("rejects anything that is not a non-negative decimal", () => {
    for (const bad of ["", " ", "-1", "abc", "1e3", "1.2.3", "1 GiB", ".5", "Infinity"]) {
      expect(parseGiB(bad), bad).toBeNull();
    }
  });

  it("rejects values too large to be exact bytes", () => {
    expect(parseGiB("9".repeat(30))).toBeNull();
  });
});

describe("toGiBInput", () => {
  it("round-trips the common cases", () => {
    expect(toGiBInput(100 * GIB)).toBe("100");
    expect(toGiBInput(1.5 * GIB)).toBe("1.5");
    expect(toGiBInput(0)).toBe("0");
    expect(parseGiB(toGiBInput(25 * GIB))).toBe(25 * GIB);
  });
});

describe("formatDate", () => {
  it("formats an ISO timestamp as a medium date", () => {
    expect(formatDate("2026-10-13T12:00:00.000Z")).toMatch(/2026/);
  });
});
