import { describe, expect, it } from "vitest";
import { safeFileName } from "./share-store";

describe("safeFileName", () => {
  it("keeps an ordinary name", () => {
    expect(safeFileName("IMG_0042.jpg", 0)).toBe("IMG_0042.jpg");
    expect(safeFileName("Urlaubsfoto — Ålesund.png", 1)).toBe("Urlaubsfoto — Ålesund.png");
  });

  it("replaces path separators and control characters", () => {
    expect(safeFileName("a/b\\c.txt", 0)).toBe("a_b_c.txt");
    expect(safeFileName("a\u0001b.txt", 0)).toBe("a_b.txt");
  });

  it("falls back to a numbered name when nothing usable is left", () => {
    expect(safeFileName("", 0)).toBe("shared-1");
    expect(safeFileName("   ", 2)).toBe("shared-3");
    expect(safeFileName("..", 1)).toBe("shared-2");
  });

  it("trims whitespace and caps the length at 255", () => {
    expect(safeFileName("  spaced.txt ", 0)).toBe("spaced.txt");
    expect(safeFileName("x".repeat(400), 0)).toHaveLength(255);
  });
});
