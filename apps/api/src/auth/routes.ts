import { and, count, eq, gt, isNull, lt } from "drizzle-orm";
import { Router } from "express";
import {
  DEFAULT_QUOTA_BYTES,
  loginRequest,
  registerRequest,
  type LoginResponse,
  setupRequest,
  type MeResponse,
  type SetupStatusResponse,
} from "@cloud/shared";
import { recordActivity } from "../activity/record.js";
import type { Db } from "../db/client.js";
import { invites, sessions, users } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { ACCOUNT_LOGIN_LIMIT, createRateLimiter, FAILURE_LIMIT } from "./rate-limit.js";
import {
  authOf,
  ownTokenHash,
  PENDING_SESSION_TTL_MS,
  revokeOtherSessions,
  sessionOf,
  toUser,
  type SessionService,
} from "./sessions.js";
import { totpEnabled } from "./second-factor.js";
import { hashToken } from "./tokens.js";

export function createAuthRouter(opts: {
  db: Db;
  sessions: SessionService;
  now: () => number;
}): Router {
  const { db, sessions: sessionService, now } = opts;
  const limiterOptions = { ...FAILURE_LIMIT, now };
  const loginLimiter = createRateLimiter(limiterOptions);
  const accountLimiter = createRateLimiter({ ...ACCOUNT_LOGIN_LIMIT, now });
  const registerLimiter = createRateLimiter(limiterOptions);
  const setupLimiter = createRateLimiter(limiterOptions);
  const router = Router();

  router.get("/setup", (_req, res) => {
    const row = db.select({ n: count() }).from(users).get();
    const body: SetupStatusResponse = { needsSetup: (row?.n ?? 0) === 0 };
    res.json(body);
  });

  router.post("/setup", async (req, res) => {
    const ip = req.ip ?? "unknown";
    setupLimiter.check(ip);
    const body = setupRequest.parse(req.body);
    const alreadyDone = (db.select({ n: count() }).from(users).get()?.n ?? 0) > 0;
    if (alreadyDone) {
      setupLimiter.fail(ip);
      throw new HttpError(409, "setup_already_done");
    }
    const passwordHash = await hashPassword(body.password);
    const { row, token } = db.transaction((tx) => {
      // Re-check inside the transaction: two concurrent setups cannot both win.
      if ((tx.select({ n: count() }).from(users).get()?.n ?? 0) > 0) {
        throw new HttpError(409, "setup_already_done");
      }
      const created = tx
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          email: body.email,
          passwordHash,
          role: "admin",
          quotaBytes: DEFAULT_QUOTA_BYTES,
          createdAt: new Date(now()),
        })
        .returning()
        .get();
      return { row: created, token: sessionService.insert(tx, created.id, req.get("user-agent")) };
    });
    setupLimiter.clear(ip);
    sessionService.setCookie(res, token);
    const response: MeResponse = { user: toUser(row) };
    res.status(201).json(response);
  });

  router.post("/login", async (req, res) => {
    const { email, password } = loginRequest.parse(req.body);
    const ip = req.ip;
    const key = `${ip ?? "unknown"}|${email}`;
    const accountKey = `user:${email}`;
    // Counted before the Argon2 await: parallel guesses must not all pass a not-yet-failed check.
    loginLimiter.check(key);
    accountLimiter.check(accountKey);
    loginLimiter.begin(key);
    accountLimiter.begin(accountKey);
    const row = db.select().from(users).where(eq(users.email, email)).get();
    const ok = await verifyPassword(row?.passwordHash, password);
    if (!row || !ok) {
      // Only a known email is attributed; unknown ones would let anyone fill the log.
      if (row) {
        recordActivity(db, {
          userId: row.id,
          type: "login_failed",
          detail: { method: "password" },
          ip,
          at: now(),
        });
      }
      throw new HttpError(401, "invalid_credentials");
    }
    loginLimiter.clear(key);
    accountLimiter.release(accountKey);
    const mfaRequired = totpEnabled(db, row.id);
    const token = db.transaction((tx) => {
      tx.delete(sessions)
        .where(and(eq(sessions.userId, row.id), lt(sessions.expiresAt, new Date(now()))))
        .run();
      const created = sessionService.insert(tx, row.id, req.get("user-agent"), {
        mfaPending: mfaRequired,
      });
      // With a second factor the sign-in is not complete yet; it is logged after the code.
      if (!mfaRequired) {
        recordActivity(tx, {
          userId: row.id,
          type: "login_succeeded",
          detail: { method: "password" },
          ip,
          at: now(),
        });
      }
      return created;
    });
    sessionService.setCookie(res, token, mfaRequired ? PENDING_SESSION_TTL_MS : undefined);
    const response: LoginResponse = mfaRequired ? { mfaRequired: true } : { user: toUser(row) };
    res.json(response);
  });

  router.post("/register", async (req, res) => {
    const ip = req.ip ?? "unknown";
    registerLimiter.check(ip);
    const body = registerRequest.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    let result;
    try {
      result = db.transaction((tx) => {
        const at = new Date(now());
        const consumed = tx
          .update(invites)
          .set({ usedAt: at })
          .where(
            and(
              eq(invites.tokenHash, hashToken(body.token)),
              isNull(invites.usedAt),
              isNull(invites.revokedAt),
              gt(invites.expiresAt, at),
            ),
          )
          .returning({ role: invites.role })
          .all()[0];
        if (!consumed) throw new HttpError(404, "invite_invalid");
        if (tx.select({ id: users.id }).from(users).where(eq(users.email, body.email)).get()) {
          // Throwing rolls the transaction back, so the invite stays usable.
          throw new HttpError(409, "email_taken");
        }
        const created = tx
          .insert(users)
          .values({
            id: crypto.randomUUID(),
            email: body.email,
            passwordHash,
            role: consumed.role,
            quotaBytes: DEFAULT_QUOTA_BYTES,
            createdAt: at,
          })
          .returning()
          .get();
        return {
          row: created,
          token: sessionService.insert(tx, created.id, req.get("user-agent")),
        };
      });
    } catch (err) {
      if (err instanceof HttpError) registerLimiter.fail(ip);
      throw err;
    }
    registerLimiter.clear(ip);
    sessionService.setCookie(res, result.token);
    const response: MeResponse = { user: toUser(result.row) };
    res.status(201).json(response);
  });

  router.post("/logout", sessionService.requireUserOrPending, (req, res) => {
    const { tokenHash, user, mfaPending } = sessionOf(res);
    db.transaction((tx) => {
      tx.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
      // A session that never finished signing in was never a login, so it has no logout.
      if (!mfaPending) {
        recordActivity(tx, { userId: user.id, type: "logout", ip: req.ip, at: now() });
      }
    });
    sessionService.clearCookie(res);
    res.status(204).end();
  });

  // "Sign out everywhere else": the caller's own session stays, every other one ends.
  router.post("/sessions/revoke-others", sessionService.requireUser, (req, res) => {
    const { user } = authOf(res);
    revokeOtherSessions(db, user.id, ownTokenHash(res));
    res.status(204).end();
  });

  router.get("/me", sessionService.requireUser, (_req, res) => {
    const response: MeResponse = { user: authOf(res).user };
    res.json(response);
  });

  return router;
}
