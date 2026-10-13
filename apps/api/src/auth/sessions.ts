import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { RequestHandler, Response } from "express";
import { parseCookie, stringifySetCookie } from "cookie";
import type { Role, User } from "@cloud/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { appPasswords, sessions, users } from "../db/schema/index.js";
import { bearerToken } from "../http/bearer.js";
import { HttpError } from "../http/errors.js";
import { hashToken, newToken } from "./tokens.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * DAY_MS;
export const SESSION_RENEW_BELOW_MS = 15 * DAY_MS;
/** A session that only passed the password step is good for this long, never renewed. */
export const PENDING_SESSION_TTL_MS = 10 * 60 * 1000;
/** lastUsedAt of an app password is written at most this often. */
const APP_PASSWORD_TOUCH_MS = 60 * 1000;
const COOKIE_NAME = "sid";

export type AuthContext =
  | { via: "session"; user: User; tokenHash: string; mfaPending: boolean }
  | { via: "bearer"; user: User; appPasswordId: string };

const contexts = new WeakMap<Response, AuthContext>();

export function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    quotaBytes: row.quotaBytes,
    createdAt: row.createdAt.toISOString(),
  };
}

export function authOf(res: Response): AuthContext {
  const ctx = contexts.get(res);
  if (!ctx) throw new HttpError(401, "unauthenticated");
  return ctx;
}

/** For routes that act on the cookie session itself; an app password has none. */
export function sessionOf(res: Response): Extract<AuthContext, { via: "session" }> {
  const ctx = authOf(res);
  if (ctx.via !== "session") throw new HttpError(404, "not_found");
  return ctx;
}

export interface SessionService {
  /** Inserts a session row and returns the raw token (shown to the client once, via cookie). */
  insert(
    db: Pick<Db, "insert">,
    userId: string,
    userAgent: string | undefined,
    opts?: { mfaPending?: boolean },
  ): string;
  setCookie(res: Response, token: string, maxAgeMs?: number): void;
  clearCookie(res: Response): void;
  destroy(res: Response, tokenHash: string): void;
  /**
   * A fully signed-in user: a cookie session, or an app password sent as Bearer. A session
   * still waiting for its second factor answers 401 mfa_required.
   */
  requireUser: RequestHandler;
  /** Like requireUser but lets a session waiting for its second factor through. */
  requireUserOrPending: RequestHandler;
  requireRole(role: Role): RequestHandler;
}

export function createSessionService(opts: {
  db: Db;
  config: Config;
  now: () => number;
}): SessionService {
  const { db, config, now } = opts;

  function cookie(value: string, maxAgeSeconds: number): string {
    return stringifySetCookie({
      name: COOKIE_NAME,
      value,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: config.production,
      maxAge: maxAgeSeconds,
    });
  }

  function authenticateBearer(token: string, res: Response): void {
    if (token === "") throw new HttpError(401, "unauthenticated");
    const row = db
      .select({ id: appPasswords.id, user: users })
      .from(appPasswords)
      .innerJoin(users, eq(appPasswords.userId, users.id))
      .where(eq(appPasswords.tokenHash, hashToken(token)))
      .get();
    if (!row) throw new HttpError(401, "unauthenticated");
    const current = now();
    db.update(appPasswords)
      .set({ lastUsedAt: new Date(current) })
      .where(
        and(
          eq(appPasswords.id, row.id),
          or(
            isNull(appPasswords.lastUsedAt),
            lt(appPasswords.lastUsedAt, new Date(current - APP_PASSWORD_TOUCH_MS)),
          ),
        ),
      )
      .run();
    contexts.set(res, { via: "bearer", user: toUser(row.user), appPasswordId: row.id });
  }

  function authenticate(allowPending: boolean): RequestHandler {
    return (req, res, next) => {
      // Bearer wins: when the header is present the cookie is not even looked at.
      const bearer = bearerToken(req);
      if (bearer !== null) {
        try {
          authenticateBearer(bearer, res);
        } catch (err) {
          next(err);
          return;
        }
        next();
        return;
      }
      const raw = parseCookie(req.headers.cookie ?? "")[COOKIE_NAME];
      if (!raw) {
        next(new HttpError(401, "unauthenticated"));
        return;
      }
      const tokenHash = hashToken(raw);
      const row = db
        .select({ expiresAt: sessions.expiresAt, mfaPending: sessions.mfaPending, user: users })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.tokenHash, tokenHash))
        .get();
      if (!row) {
        service.clearCookie(res);
        next(new HttpError(401, "unauthenticated"));
        return;
      }
      const current = now();
      const remaining = row.expiresAt.getTime() - current;
      if (remaining <= 0) {
        service.destroy(res, tokenHash);
        next(new HttpError(401, "unauthenticated"));
        return;
      }
      if (row.mfaPending && !allowPending) {
        next(new HttpError(401, "mfa_required"));
        return;
      }
      if (!row.mfaPending && remaining < SESSION_RENEW_BELOW_MS) {
        db.update(sessions)
          .set({ expiresAt: new Date(current + SESSION_TTL_MS) })
          .where(eq(sessions.tokenHash, tokenHash))
          .run();
        service.setCookie(res, raw);
      }
      contexts.set(res, {
        via: "session",
        user: toUser(row.user),
        tokenHash,
        mfaPending: row.mfaPending,
      });
      next();
    };
  }

  const service: SessionService = {
    insert(target, userId, userAgent, opts) {
      const token = newToken();
      const created = now();
      const mfaPending = opts?.mfaPending ?? false;
      target
        .insert(sessions)
        .values({
          tokenHash: hashToken(token),
          userId,
          createdAt: new Date(created),
          expiresAt: new Date(created + (mfaPending ? PENDING_SESSION_TTL_MS : SESSION_TTL_MS)),
          userAgent: userAgent?.slice(0, 255) ?? null,
          mfaPending,
        })
        .run();
      return token;
    },

    setCookie(res, token, maxAgeMs = SESSION_TTL_MS) {
      res.append("Set-Cookie", cookie(token, Math.floor(maxAgeMs / 1000)));
    },

    clearCookie(res) {
      res.append("Set-Cookie", cookie("", 0));
    },

    destroy(res, tokenHash) {
      db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
      service.clearCookie(res);
    },

    requireUser: authenticate(false),
    requireUserOrPending: authenticate(true),

    requireRole(role) {
      return (_req, res, next) => {
        // Non-admins get not_found so the admin surface does not exist for them.
        next(contexts.get(res)?.user.role === role ? undefined : new HttpError(404, "not_found"));
      };
    },
  };
  return service;
}
