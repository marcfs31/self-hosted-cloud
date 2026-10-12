import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Fail closed: every state-changing request must carry Origin === PUBLIC_ORIGIN. */
export function requireSameOrigin(publicOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method) || req.get("origin") === publicOrigin) {
      next();
      return;
    }
    next(new HttpError(403, "origin_rejected"));
  };
}
