import { randomBytes } from "node:crypto";
import { and, count, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { DbHandle } from "../db/handle.js";
import { recoveryCodes, totp } from "../db/schema/index.js";
import { hashToken } from "./tokens.js";
import { base32Encode, verifyTotp } from "./totp.js";

export const RECOVERY_CODE_COUNT = 10;

export type SecondFactorMethod = "totp" | "recovery_code";

export function totpEnabled(db: DbHandle, userId: string): boolean {
  const row = db
    .select({ n: count() })
    .from(totp)
    .where(and(eq(totp.userId, userId), isNotNull(totp.enabledAt)))
    .get();
  return (row?.n ?? 0) > 0;
}

export function recoveryCodesLeft(db: DbHandle, userId: string): number {
  const row = db
    .select({ n: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
    .get();
  return row?.n ?? 0;
}

/** "xxxxx-xxxxx": 10 base32 characters (50 bits), drawn uniformly (256 is a multiple of 32). */
export function generateRecoveryCode(): string {
  const text = base32Encode(randomBytes(7)).slice(0, 10);
  return `${text.slice(0, 5)}-${text.slice(5)}`;
}

function normalizeRecoveryCode(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-7]{10}$/.test(compact) ? compact : null;
}

export function hashRecoveryCode(normalized: string): string {
  return hashToken(normalized);
}

/** Replaces all of the user's recovery codes; returns the new codes in the clear, once. */
export function replaceRecoveryCodes(db: DbHandle, userId: string): string[] {
  db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  db.insert(recoveryCodes)
    .values(
      codes.map((code) => ({
        id: crypto.randomUUID(),
        userId,
        codeHash: hashRecoveryCode(code.replace("-", "")),
      })),
    )
    .run();
  return codes;
}

/** Marks the step used only if it is newer than the last one, so a replay cannot win. */
function consumeTotp(db: DbHandle, userId: string, code: string, nowMs: number): boolean {
  const row = db
    .select({ secret: totp.secret, lastUsedStep: totp.lastUsedStep })
    .from(totp)
    .where(and(eq(totp.userId, userId), isNotNull(totp.enabledAt)))
    .get();
  if (!row) return false;
  const step = verifyTotp(row.secret, code, nowMs, row.lastUsedStep);
  if (step === null) return false;
  const updated = db
    .update(totp)
    .set({ lastUsedStep: step })
    .where(and(eq(totp.userId, userId), or(isNull(totp.lastUsedStep), lt(totp.lastUsedStep, step))))
    .returning({ userId: totp.userId })
    .all();
  return updated.length === 1;
}

function consumeRecoveryCode(db: DbHandle, userId: string, raw: string, nowMs: number): boolean {
  const normalized = normalizeRecoveryCode(raw);
  if (!normalized) return false;
  const updated = db
    .update(recoveryCodes)
    .set({ usedAt: new Date(nowMs) })
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        eq(recoveryCodes.codeHash, hashRecoveryCode(normalized)),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id })
    .all();
  return updated.length === 1;
}

/**
 * Accepts a current TOTP code or an unused recovery code and spends it. Run it inside the
 * transaction that acts on the result. Null means the code is wrong, replayed or already used.
 */
export function consumeSecondFactor(
  db: DbHandle,
  userId: string,
  rawCode: string,
  nowMs: number,
): SecondFactorMethod | null {
  const code = rawCode.trim();
  if (/^\d{6}$/.test(code)) return consumeTotp(db, userId, code, nowMs) ? "totp" : null;
  return consumeRecoveryCode(db, userId, code, nowMs) ? "recovery_code" : null;
}
