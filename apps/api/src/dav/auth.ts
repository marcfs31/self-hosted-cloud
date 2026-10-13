import type { Request } from "express";
import type { User } from "@cloud/shared";
import { createRateLimiter, FAILURE_LIMIT } from "../auth/rate-limit.js";
import type { SessionService } from "../auth/sessions.js";
import { DavError } from "./errors.js";
import { hasBody } from "./requests.js";

const CHALLENGE = 'Basic realm="Cloud", charset="UTF-8"';
const CREDENTIALS = /^(Basic|Bearer)\s+(\S+)\s*$/i;

/**
 * Credentials for /dav are an app password and nothing else: HTTP Basic with the account email
 * as user name and the app password as password, or the same token as Bearer. The cookie
 * session is never read here, so a browser's ambient credentials cannot reach the files over
 * WebDAV, and the account password is simply an unknown token. Failed attempts are counted per
 * client address (5 per 15 minutes, like sign-in); a request without credentials is only the
 * challenge every WebDAV client starts with and costs nothing.
 */
export function createDavAuth(opts: {
  sessions: SessionService;
  now: () => number;
}): (req: Request) => User {
  const limiter = createRateLimiter({ ...FAILURE_LIMIT, now: opts.now });
  // A client that sent a body before being challenged must not keep a connection with unread bytes.
  const unauthorized = (req: Request) =>
    new DavError(401, undefined, [], {
      "WWW-Authenticate": CHALLENGE,
      ...(hasBody(req) && { Connection: "close" }),
    });

  return (req) => {
    const header = req.headers.authorization;
    if (header === undefined) throw unauthorized(req);
    const ip = req.ip ?? "unknown";
    limiter.check(ip);
    const match = CREDENTIALS.exec(header);
    let found: ReturnType<SessionService["appPasswordUser"]>;
    if (match) {
      const credential = match[2] ?? "";
      if (match[1]?.toLowerCase() === "bearer") {
        found = opts.sessions.appPasswordUser(credential);
      } else {
        const decoded = Buffer.from(credential, "base64").toString("utf8");
        const colon = decoded.indexOf(":");
        if (colon > 0) {
          found = opts.sessions.appPasswordUser(
            decoded.slice(colon + 1),
            decoded.slice(0, colon).trim().toLowerCase(),
          );
        }
      }
    }
    if (!found) {
      limiter.fail(ip);
      throw unauthorized(req);
    }
    limiter.clear(ip);
    return found.user;
  };
}
