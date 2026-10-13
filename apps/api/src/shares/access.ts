import { and, eq, isNull } from "drizzle-orm";
import type { Request, Response } from "express";
import { parseCookie, stringifySetCookie } from "cookie";
import type { FileKind } from "@cloud/shared";
import { hashToken, newToken } from "../auth/tokens.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { files, shares } from "../db/schema/index.js";
import { chainOf, findOwned, isActive, type FileRow } from "../files/tree.js";
import { HttpError } from "../http/errors.js";

export type ShareRow = typeof shares.$inferSelect;

export interface ResolvedShare {
  share: ShareRow;
  /** The shared file or folder. */
  target: FileRow;
}

export const GRANT_TTL_MS = 60 * 60 * 1000;
const MAX_TOKEN_LENGTH = 256;

/** Where a share's grant cookie is valid; the token is base64url, so it is safe in a Path. */
export function publicSharePath(token: string): string {
  return `/api/public/shares/${token}`;
}

export interface ShareAccess {
  /**
   * The only way a public route turns a token into a share: hash it, find a non-revoked,
   * unexpired share whose target is active. Anything else is 404 not_found.
   */
  resolve(token: string): ResolvedShare;
  /**
   * The security core of folder shares: `id` must be the shared item or a descendant of it, owned
   * by the share's owner and active (nothing in its ancestor chain trashed), else 404.
   */
  requireInside(resolved: ResolvedShare, id: string, kind?: FileKind): FileRow;
  /** The shared item first, down to `id`; `id` must already have passed requireInside. */
  chainFromShare(resolved: ResolvedShare, id: string): { id: string; name: string }[];
  /** 401 share_locked unless the share has no password or the request carries a live grant. */
  requireUnlocked(req: Request, resolved: ResolvedShare): void;
  isUnlocked(req: Request, resolved: ResolvedShare): boolean;
  /** Remember a grant for the share and set its HttpOnly cookie on the response. */
  issueGrant(res: Response, token: string, shareId: string): void;
}

export function createShareAccess(opts: {
  db: Db;
  config: Config;
  now: () => number;
}): ShareAccess {
  const { db, config, now } = opts;
  // grant id → share it unlocks. In memory on purpose: a restart just asks for the password again.
  const grants = new Map<string, { shareId: string; expiresAt: number }>();

  function cookieName(shareId: string): string {
    return `sg_${shareId}`;
  }

  function resolve(token: string): ResolvedShare {
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH)
      throw new HttpError(404, "not_found");
    const row = db
      .select({ share: shares, target: files })
      .from(shares)
      .innerJoin(files, eq(files.id, shares.fileId))
      .where(and(eq(shares.tokenHash, hashToken(token)), isNull(shares.revokedAt)))
      .get();
    if (!row) throw new HttpError(404, "not_found");
    const { share, target } = row;
    if (share.expiresAt !== null && share.expiresAt.getTime() <= now()) {
      throw new HttpError(404, "not_found");
    }
    if (target.ownerId !== share.ownerId || !isActive(db, target.id)) {
      throw new HttpError(404, "not_found");
    }
    return row;
  }

  function requireInside(resolved: ResolvedShare, id: string, kind?: FileKind): FileRow {
    const notFound = new HttpError(404, "not_found");
    const row = findOwned(db, resolved.share.ownerId, id);
    if (!row || (kind !== undefined && row.kind !== kind)) throw notFound;
    const chain = chainOf(db, id);
    const active = chain.length > 0 && chain.every((entry) => entry.deletedAt === null);
    if (!active || !chain.some((entry) => entry.id === resolved.target.id)) throw notFound;
    return row;
  }

  function chainFromShare(resolved: ResolvedShare, id: string): { id: string; name: string }[] {
    const chain = chainOf(db, id).map(({ id: entryId, name }) => ({ id: entryId, name }));
    const at = chain.findIndex((entry) => entry.id === resolved.target.id);
    return chain.slice(0, at + 1).reverse();
  }

  function isUnlocked(req: Request, resolved: ResolvedShare): boolean {
    if (resolved.share.passwordHash === null) return true;
    const grantId = parseCookie(req.headers.cookie ?? "")[cookieName(resolved.share.id)];
    if (!grantId) return false;
    const grant = grants.get(grantId);
    if (!grant) return false;
    if (grant.expiresAt <= now()) {
      grants.delete(grantId);
      return false;
    }
    return grant.shareId === resolved.share.id;
  }

  return {
    resolve,
    requireInside,
    chainFromShare,
    isUnlocked,
    requireUnlocked(req, resolved) {
      if (!isUnlocked(req, resolved)) throw new HttpError(401, "share_locked");
    },
    issueGrant(res, token, shareId) {
      const at = now();
      for (const [id, grant] of grants) if (grant.expiresAt <= at) grants.delete(id);
      const grantId = newToken();
      grants.set(grantId, { shareId, expiresAt: at + GRANT_TTL_MS });
      res.append(
        "Set-Cookie",
        stringifySetCookie({
          name: cookieName(shareId),
          value: grantId,
          httpOnly: true,
          sameSite: "lax",
          path: publicSharePath(token),
          secure: config.production,
          maxAge: GRANT_TTL_MS / 1000,
        }),
      );
    },
  };
}
