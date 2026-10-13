import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateSecret,
  hotp,
  otpauthUrl,
  timeStep,
  totpAt,
  verifyTotp,
} from "./totp.js";

// RFC 6238 appendix B, SHA-1 column (8 digits, secret "12345678901234567890").
const RFC_KEY = Buffer.from("12345678901234567890");
const RFC_VECTORS: [seconds: number, code: string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("TOTP (RFC 6238)", () => {
  it.each(RFC_VECTORS)("matches the SHA-1 test vector at t=%i", (seconds, code) => {
    expect(hotp(RFC_KEY, timeStep(seconds * 1000), 8)).toBe(code);
    // The 6-digit code is the same truncated value modulo 10^6.
    expect(totpAt(base32Encode(RFC_KEY), seconds * 1000)).toBe(code.slice(2));
  });

  it("matches the RFC 4226 HOTP test values", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676"];
    expected.forEach((code, counter) => {
      expect(hotp(RFC_KEY, counter)).toBe(code);
    });
  });

  it("round-trips base32 and generates a 20-byte secret", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateSecret()).not.toBe(secret);
    expect(() => base32Decode("not base32!")).toThrow();
  });

  it("accepts the previous, current and next step and nothing further", () => {
    const secret = base32Encode(RFC_KEY);
    const now = 1111111111 * 1000;
    const step = timeStep(now);
    const at = (s: number) => hotp(RFC_KEY, s);
    expect(verifyTotp(secret, at(step), now, null)).toBe(step);
    expect(verifyTotp(secret, at(step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, at(step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(secret, at(step - 2), now, null)).toBeNull();
    expect(verifyTotp(secret, at(step + 2), now, null)).toBeNull();
  });

  it("rejects a code from a step that was already used, or an earlier one", () => {
    const secret = base32Encode(RFC_KEY);
    const now = 1111111111 * 1000;
    const step = timeStep(now);
    expect(verifyTotp(secret, hotp(RFC_KEY, step), now, step)).toBeNull();
    expect(verifyTotp(secret, hotp(RFC_KEY, step - 1), now, step)).toBeNull();
    expect(verifyTotp(secret, hotp(RFC_KEY, step + 1), now, step)).toBe(step + 1);
  });

  it("rejects malformed codes", () => {
    const secret = base32Encode(RFC_KEY);
    for (const bad of ["", "12345", "1234567", "abcdef", "12 456", "١٢٣٤٥٦"]) {
      expect(verifyTotp(secret, bad, 59_000, null)).toBeNull();
    }
  });

  it("builds the otpauth URL an authenticator app expects", () => {
    expect(otpauthUrl("me@example.com", "ABCDEFGH")).toBe(
      "otpauth://totp/Cloud:me%40example.com?secret=ABCDEFGH&issuer=Cloud",
    );
  });
});
