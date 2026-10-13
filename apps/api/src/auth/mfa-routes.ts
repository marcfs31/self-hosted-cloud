import { and, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import {
  totpDisableRequest,
  totpEnableRequest,
  totpLoginRequest,
  type MeResponse,
  type RecoveryCodesResponse,
  type TotpSetupResponse,
  type TotpStatus,
} from "@cloud/shared";
import { recordActivity } from "../activity/record.js";
import type { Db } from "../db/client.js";
import { recoveryCodes, sessions, totp, users } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";
import { verifyPassword } from "./passwords.js";
import { createRateLimiter, FAILURE_LIMIT } from "./rate-limit.js";
import {
  consumeSecondFactor,
  recoveryCodesLeft,
  replaceRecoveryCodes,
  totpEnabled,
} from "./second-factor.js";
import { authOf, sessionOf, type SessionService } from "./sessions.js";
import { generateSecret, otpauthUrl, verifyTotp } from "./totp.js";

export function createMfaRouter(opts: {
  db: Db;
  sessions: SessionService;
  now: () => number;
}): Router {
  const { db, sessions: sessionService, now } = opts;
  const limiter = createRateLimiter({ ...FAILURE_LIMIT, now });
  const router = Router();

  /** Code guesses are limited per user (across sessions) and per address. */
  function keysFor(userId: string, ip: string | undefined): string[] {
    return [`user:${userId}`, `ip:${ip ?? "unknown"}`];
  }

  router.post("/login/totp", sessionService.requireUserOrPending, (req, res) => {
    const { code } = totpLoginRequest.parse(req.body);
    const session = sessionOf(res);
    if (!session.mfaPending) throw new HttpError(400, "invalid_request");
    const { user } = session;
    const keys = keysFor(user.id, req.ip);
    keys.forEach((key) => {
      limiter.check(key);
    });

    const result = db.transaction((tx) => {
      const method = consumeSecondFactor(tx, user.id, code, now());
      if (!method) return null;
      // Rotate: the pending token is deleted and a fresh one issued (session fixation).
      tx.delete(sessions).where(eq(sessions.tokenHash, session.tokenHash)).run();
      const token = sessionService.insert(tx, user.id, req.get("user-agent"));
      recordActivity(tx, {
        userId: user.id,
        type: "login_succeeded",
        detail: { method },
        ip: req.ip,
        at: now(),
      });
      return token;
    });
    if (result === null) {
      keys.forEach((key) => {
        limiter.fail(key);
      });
      recordActivity(db, {
        userId: user.id,
        type: "login_failed",
        detail: { method: "totp" },
        ip: req.ip,
        at: now(),
      });
      throw new HttpError(401, "invalid_code");
    }
    keys.forEach((key) => {
      limiter.clear(key);
    });
    sessionService.setCookie(res, result);
    const response: MeResponse = { user };
    res.json(response);
  });

  router.get("/totp", sessionService.requireUser, (_req, res) => {
    const { id } = authOf(res).user;
    const body: TotpStatus = {
      enabled: totpEnabled(db, id),
      recoveryCodesLeft: recoveryCodesLeft(db, id),
    };
    res.json(body);
  });

  router.post("/totp/setup", sessionService.requireUser, (_req, res) => {
    const { id, email } = authOf(res).user;
    if (totpEnabled(db, id)) throw new HttpError(409, "invalid_request");
    const secret = generateSecret();
    db.insert(totp)
      .values({ userId: id, secret })
      .onConflictDoUpdate({
        target: totp.userId,
        set: { secret, enabledAt: null, lastUsedStep: null },
      })
      .run();
    const body: TotpSetupResponse = { secret, otpauthUrl: otpauthUrl(email, secret) };
    res.json(body);
  });

  router.post("/totp/enable", sessionService.requireUser, (req, res) => {
    const { code } = totpEnableRequest.parse(req.body);
    const { id } = authOf(res).user;
    const keys = keysFor(id, req.ip);
    keys.forEach((key) => {
      limiter.check(key);
    });
    const pending = db
      .select()
      .from(totp)
      .where(and(eq(totp.userId, id), isNull(totp.enabledAt)))
      .get();
    if (!pending) throw new HttpError(409, "invalid_request");
    const step = verifyTotp(pending.secret, code, now(), null);
    if (step === null) {
      keys.forEach((key) => {
        limiter.fail(key);
      });
      throw new HttpError(400, "invalid_code");
    }
    const codes = db.transaction((tx) => {
      const updated = tx
        .update(totp)
        .set({ enabledAt: new Date(now()), lastUsedStep: step })
        .where(and(eq(totp.userId, id), isNull(totp.enabledAt)))
        .returning({ userId: totp.userId })
        .all();
      if (updated.length !== 1) throw new HttpError(409, "invalid_request");
      const fresh = replaceRecoveryCodes(tx, id);
      recordActivity(tx, { userId: id, type: "totp_enabled", ip: req.ip, at: now() });
      return fresh;
    });
    keys.forEach((key) => {
      limiter.clear(key);
    });
    const body: RecoveryCodesResponse = { recoveryCodes: codes };
    res.json(body);
  });

  router.post("/totp/disable", sessionService.requireUser, async (req, res) => {
    const { password, code } = totpDisableRequest.parse(req.body);
    const { id } = authOf(res).user;
    const keys = keysFor(id, req.ip);
    keys.forEach((key) => {
      limiter.check(key);
    });
    if (!totpEnabled(db, id)) throw new HttpError(409, "invalid_request");
    const owner = db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (!(await verifyPassword(owner?.passwordHash, password))) {
      keys.forEach((key) => {
        limiter.fail(key);
      });
      throw new HttpError(401, "invalid_credentials");
    }
    const disabled = db.transaction((tx) => {
      if (!consumeSecondFactor(tx, id, code, now())) return false;
      tx.delete(totp).where(eq(totp.userId, id)).run();
      tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, id)).run();
      recordActivity(tx, { userId: id, type: "totp_disabled", ip: req.ip, at: now() });
      return true;
    });
    if (!disabled) {
      keys.forEach((key) => {
        limiter.fail(key);
      });
      throw new HttpError(400, "invalid_code");
    }
    keys.forEach((key) => {
      limiter.clear(key);
    });
    res.status(204).end();
  });

  return router;
}
