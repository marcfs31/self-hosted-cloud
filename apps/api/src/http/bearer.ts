import type { IncomingMessage } from "node:http";
import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";

const BEARER = /^Bearer(?:\s+(.*))?$/i;

/**
 * The raw token of an `Authorization: Bearer <token>` header, "" when the scheme is present
 * without a token, and null when the request does not use the Bearer scheme at all.
 */
export function bearerToken(req: Pick<IncomingMessage, "headers">): string | null {
  const match = BEARER.exec(req.headers.authorization ?? "");
  return match ? (match[1] ?? "").trim() : null;
}

/**
 * App-password requests may only use the file API. Everything under /api/auth (except
 * GET /api/auth/me) and /api/admin answers 404, whether or not the token is valid, so a
 * leaked token can neither change account security nor learn that those routes exist.
 * Mount it on both prefixes.
 */
export const rejectBearerOnAccountRoutes: RequestHandler = (req, _res, next) => {
  if (bearerToken(req) === null) {
    next();
    return;
  }
  // Express matches routes case-insensitively and ignores a trailing slash; so must this.
  const isMe =
    req.baseUrl.toLowerCase() === "/api/auth" &&
    (req.method === "GET" || req.method === "HEAD") &&
    req.path.toLowerCase().replace(/\/+$/, "") === "/me";
  next(isMe ? undefined : new HttpError(404, "not_found"));
};
