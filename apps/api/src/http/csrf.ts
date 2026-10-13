import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";
import { bearerToken } from "./bearer.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Fail closed: every state-changing request must carry Origin === PUBLIC_ORIGIN.
 *
 * Exception: a request with an `Authorization: Bearer` header. CSRF abuses the cookie a
 * browser attaches on its own; a browser never attaches an Authorization header to a
 * cross-site request unless the page sets it, and setting it forces a CORS preflight, which
 * this API never grants (it sends no Access-Control-* headers). Scripts and CLIs, which have
 * no Origin, authenticate this way. For such a request the session cookie is ignored
 * entirely (see requireUser), so a cookie can never be used to ride along on the exemption.
 */
export function requireSameOrigin(publicOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (
      SAFE_METHODS.has(req.method) ||
      bearerToken(req) !== null ||
      req.get("origin") === publicOrigin
    ) {
      next();
      return;
    }
    next(new HttpError(403, "origin_rejected"));
  };
}
