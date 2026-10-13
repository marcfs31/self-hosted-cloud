import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "./secret-box.js";

const KEY = Buffer.alloc(32, 3);
const SEED = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

describe("sealSecret / openSecret", () => {
  it("round-trips and uses the documented format with a fresh IV every time", () => {
    const a = sealSecret(KEY, SEED);
    const b = sealSecret(KEY, SEED);
    expect(a).toMatch(/^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(SEED);
    expect(openSecret(KEY, a)).toBe(SEED);
    expect(openSecret(KEY, b)).toBe(SEED);
  });

  it("fails loudly under another key", () => {
    expect(() => openSecret(randomBytes(32), sealSecret(KEY, SEED))).toThrow();
  });

  it("fails loudly when any part is altered", () => {
    const [version, iv, tag, ciphertext] = sealSecret(KEY, SEED).split(":");
    const flip = (part: string | undefined) =>
      `${part?.startsWith("A") ? "B" : "A"}${part?.slice(1)}`;
    for (const tampered of [
      [version, flip(iv), tag, ciphertext],
      [version, iv, flip(tag), ciphertext],
      [version, iv, tag, flip(ciphertext)],
    ]) {
      expect(() => openSecret(KEY, tampered.join(":"))).toThrow();
    }
  });

  it("rejects values that are not in the v1 format", () => {
    for (const bad of [SEED, "", "v2:a:b:c", "v1:a:b", "v1:a:b:c:d"]) {
      expect(() => openSecret(KEY, bad), bad).toThrow();
    }
  });
});
