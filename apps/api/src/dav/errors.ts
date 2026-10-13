import type { ErrorRequestHandler, Response } from "express";
import { HttpError } from "../http/errors.js";
import { escapeText } from "./xml.js";

/**
 * A WebDAV failure. `precondition` names a DAV: element (RFC 4918 section 16) that goes into
 * an <error> body; `hrefs` are the resources it refers to.
 */
export class DavError extends Error {
  constructor(
    readonly status: number,
    readonly precondition?: string,
    readonly hrefs: readonly string[] = [],
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(`dav ${status}${precondition ? ` ${precondition}` : ""}`);
    this.name = "DavError";
  }
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="utf-8"?>';

function errorBody(err: DavError): string | undefined {
  if (!err.precondition) return undefined;
  const inner =
    err.hrefs.length === 0
      ? `<D:${err.precondition}/>`
      : `<D:${err.precondition}>${err.hrefs.map((h) => `<D:href>${escapeText(h)}</D:href>`).join("")}</D:${err.precondition}>`;
  return `${XML_DECLARATION}<D:error xmlns:D="DAV:">${inner}</D:error>`;
}

const STATUS_FOR_CODE: Record<string, number> = {
  quota_exceeded: 507,
  name_conflict: 409,
  invalid_move: 403,
};

function respond(
  res: Response,
  status: number,
  headers: Readonly<Record<string, string>>,
  body?: string,
) {
  res.status(status);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  // After a refusal the client may still be sending a large body: do not wait for it.
  if (status === 413 || status === 507) res.setHeader("Connection", "close");
  if (body === undefined) {
    res.setHeader("Content-Length", "0");
    res.end();
    return;
  }
  res.type("application/xml; charset=utf-8").send(body);
}

/** Maps anything thrown while serving a /dav request to a bodyless (or <error>) response. */
export const davErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof DavError) {
    respond(res, err.status, err.headers, errorBody(err));
  } else if (err instanceof HttpError) {
    const headers = err.status === 429 ? { "Retry-After": "900" } : {};
    respond(res, STATUS_FOR_CODE[err.code] ?? err.status, headers);
  } else if (req.destroyed || res.destroyed) {
    // The client went away mid-request: nobody is left to answer.
    res.end();
  } else {
    console.error("dav error:", err instanceof Error ? (err.stack ?? err.name) : "non-error");
    respond(res, 500, {});
  }
};
