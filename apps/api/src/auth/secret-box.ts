import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq, not, like } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { totp } from "../db/schema/index.js";

/*
 * Secrets that must be readable again (TOTP seeds) are sealed with AES-256-GCM under SECRET_KEY.
 * Stored form: "v1:<iv>:<tag>:<ciphertext>", each part base64url. A base32 seed never contains
 * a colon, so a legacy plaintext value is told apart by its missing "v1:" prefix.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const PREFIX = `${VERSION}:`;

export function sealSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    VERSION,
    ...[iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64url")),
  ].join(":");
}

/** Throws when the value is malformed, tampered with, or sealed under another key. */
export function openSecret(key: Buffer, stored: string): string {
  const [version, iv, tag, ciphertext, extra] = stored.split(":");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || extra !== undefined) {
    throw new Error("unsupported secret format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Seals every TOTP secret still stored in the clear, in one transaction. Safe to run on every
 * start: sealed rows are left alone, so a second run changes nothing. Returns the number sealed.
 */
export function sealLegacyTotpSecrets(db: Db, key: Buffer): number {
  return db.transaction((tx) => {
    const legacy = tx
      .select({ userId: totp.userId, secret: totp.secret })
      .from(totp)
      .where(not(like(totp.secret, `${PREFIX}%`)))
      .all();
    for (const row of legacy) {
      tx.update(totp)
        .set({ secret: sealSecret(key, row.secret) })
        .where(eq(totp.userId, row.userId))
        .run();
    }
    return legacy.length;
  });
}
