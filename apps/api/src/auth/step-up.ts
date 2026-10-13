import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";
import { verifyPassword } from "./passwords.js";
import { createRateLimiter, FAILURE_LIMIT } from "./rate-limit.js";
import { consumeSecondFactor, totpEnabled } from "./second-factor.js";

export interface StepUpInput {
  password: string;
  code?: string | undefined;
}

export interface StepUp {
  /**
   * Re-authenticates the signed-in user before something that mints a long-lived credential:
   * the current password, plus a TOTP or recovery code when two-step verification is on.
   * 401 invalid_credentials / invalid_code, 429 too_many_attempts.
   */
  verify(userId: string, ip: string | undefined, input: StepUpInput): Promise<void>;
  /** The password alone, for changing it. */
  verifyPassword(userId: string, ip: string | undefined, password: string): Promise<void>;
}

/** One limiter for every step-up: guesses count per user (across sessions) and per address. */
export function createStepUp(opts: { db: Db; secretKey: Buffer; now: () => number }): StepUp {
  const { db, secretKey, now } = opts;
  const limiter = createRateLimiter({ ...FAILURE_LIMIT, now });

  async function run(
    userId: string,
    ip: string | undefined,
    password: string,
    /** null: no second factor is asked for. */
    second: { code: string | undefined } | null,
  ): Promise<void> {
    const keys = [`user:${userId}`, `ip:${ip ?? "unknown"}`];
    // Counted before the Argon2 await: parallel guesses must not all pass a not-yet-failed check.
    // Check every key first so a refused attempt is not also charged to the other key.
    keys.forEach((key) => {
      limiter.check(key);
    });
    keys.forEach((key) => {
      limiter.begin(key);
    });
    const owner = db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!(await verifyPassword(owner?.passwordHash, password))) {
      throw new HttpError(401, "invalid_credentials");
    }
    if (second !== null && totpEnabled(db, userId)) {
      const { code } = second;
      const accepted =
        code !== undefined &&
        db.transaction((tx) => consumeSecondFactor(tx, userId, code, now(), secretKey)) !== null;
      if (!accepted) throw new HttpError(401, "invalid_code");
    }
    keys.forEach((key) => {
      limiter.release(key);
    });
  }

  return {
    verify: (userId, ip, { password, code }) => run(userId, ip, password, { code }),
    verifyPassword: (userId, ip, password) => run(userId, ip, password, null),
  };
}
