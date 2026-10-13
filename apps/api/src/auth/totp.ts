import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * TOTP per RFC 6238 on top of HOTP (RFC 4226): HMAC-SHA1, 6 digits, 30 s steps. Written
 * against node:crypto so there is no extra dependency to audit.
 */

export const STEP_SECONDS = 30;
export const DIGITS = 6;
/** Codes from one step before and after the current one are accepted (clock drift). */
export const WINDOW_STEPS = 1;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET.charAt((value << (5 - bits)) & 31);
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.toUpperCase().replace(/=+$/, "")) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 20 random bytes (the SHA-1 block-friendly size RFC 4226 recommends) as base32. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function timeStep(epochMs: number): number {
  return Math.floor(epochMs / 1000 / STEP_SECONDS);
}

/** RFC 4226 HOTP with dynamic truncation. */
export function hotp(key: Uint8Array, counter: number, digits: number = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpAt(secret: string, epochMs: number): string {
  return hotp(base32Decode(secret), timeStep(epochMs));
}

/**
 * Returns the matching time step, or null. A step at or below `lastUsedStep` is a replay and
 * never matches, so a code (and any code of an earlier step) works once.
 */
export function verifyTotp(
  secret: string,
  code: string,
  epochMs: number,
  lastUsedStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const current = timeStep(epochMs);
  const given = Buffer.from(code);
  let match: number | null = null;
  // Check every step in the window (no early exit) so timing does not reveal which one matched.
  for (let step = current - WINDOW_STEPS; step <= current + WINDOW_STEPS; step++) {
    const expected = Buffer.from(hotp(key, step));
    if (timingSafeEqual(expected, given) && (lastUsedStep === null || step > lastUsedStep)) {
      match = step;
    }
  }
  return match;
}

export function otpauthUrl(email: string, secret: string): string {
  return `otpauth://totp/Cloud:${encodeURIComponent(email)}?secret=${secret}&issuer=Cloud`;
}
