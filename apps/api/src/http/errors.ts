import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ErrorCode, ErrorResponse } from "@cloud/shared";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
  ) {
    super(code);
    this.name = "HttpError";
  }
}

function isClientBodyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { status?: unknown; expose?: unknown };
  return typeof e.status === "number" && e.status >= 400 && e.status < 500 && e.expose === true;
}

function send(res: Parameters<ErrorRequestHandler>[2], status: number, code: ErrorCode): void {
  const body: ErrorResponse = { error: { code } };
  res.status(status).json(body);
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, "not_found"));
};

// Four-argument signature is what makes Express treat this as an error handler.
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof HttpError) {
    send(res, err.status, err.code);
  } else if (err instanceof ZodError || isClientBodyError(err)) {
    send(res, 400, "invalid_request");
  } else {
    // Log the error class and stack only: never request bodies, passwords or tokens.
    console.error("unhandled error:", err instanceof Error ? (err.stack ?? err.name) : "non-error");
    send(res, 500, "internal");
  }
};
