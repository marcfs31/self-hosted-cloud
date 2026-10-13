import { eq } from "drizzle-orm";
import type { RequestHandler, Response } from "express";
import { parseCookie, stringifySetCookie } from "cookie";
import type { Role, User } from "@cloud/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { sessions, users } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";
import { hashToken, newToken } from "./tokens.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * DAY_MS;
export const SESSION_RENEW_BELOW_MS = 15 * DAY_MS;
const COOKIE_NAME = "sid";

export interface AuthContext {
  user: User;
  tokenHash: string;
}

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

export interface SessionService {
  /** Inserts a session row and returns the raw token (shown to the client once, via cookie). */
  insert(db: Pick<Db, "insert">, userId: string, userAgent: string | undefined): string;
  setCookie(res: Response, token: string): void;
  clearCookie(res: Response): void;
  destroy(res: Response, tokenHash: string): void;
  requireUser: RequestHandler;
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

  const service: SessionService = {
    insert(target, userId, userAgent) {
      const token = newToken();
      const created = now();
      target
        .insert(sessions)
        .values({
          tokenHash: hashToken(token),
          userId,
          createdAt: new Date(created),
          expiresAt: new Date(created + SESSION_TTL_MS),
          userAgent: userAgent?.slice(0, 255) ?? null,
        })
        .run();
      return token;
    },

    setCookie(res, token) {
      res.append("Set-Cookie", cookie(token, SESSION_TTL_MS / 1000));
    },

    clearCookie(res) {
      res.append("Set-Cookie", cookie("", 0));
    },

    destroy(res, tokenHash) {
      db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
      service.clearCookie(res);
    },

    requireUser(req, res, next) {
      const raw = parseCookie(req.headers.cookie ?? "")[COOKIE_NAME];
      if (!raw) {
        next(new HttpError(401, "unauthenticated"));
        return;
      }
      const tokenHash = hashToken(raw);
      const row = db
        .select({ expiresAt: sessions.expiresAt, user: users })
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
      if (remaining < SESSION_RENEW_BELOW_MS) {
        db.update(sessions)
          .set({ expiresAt: new Date(current + SESSION_TTL_MS) })
          .where(eq(sessions.tokenHash, tokenHash))
          .run();
        service.setCookie(res, raw);
      }
      contexts.set(res, { user: toUser(row.user), tokenHash });
      next();
    },

    requireRole(role) {
      return (_req, res, next) => {
        // Non-admins get not_found so the admin surface does not exist for them.
        next(contexts.get(res)?.user.role === role ? undefined : new HttpError(404, "not_found"));
      };
    },
  };
  return service;
}
