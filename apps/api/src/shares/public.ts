import { eq } from "drizzle-orm";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  unlockShareRequest,
  type FileNode,
  type PublicFolderListing,
  type PublicNode,
  type PublicShareInfo,
} from "@cloud/shared";
import { createRateLimiter } from "../auth/rate-limit.js";
import { verifyPassword } from "../auth/passwords.js";
import { toUser } from "../auth/sessions.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { users } from "../db/schema/index.js";
import { findVersion, sendBlob } from "../files/content.js";
import { getNode, listChildren } from "../files/tree.js";
import type { UploadService } from "../files/uploads.js";
import { HttpError } from "../http/errors.js";
import { createShareAccess, publicSharePath, type ResolvedShare } from "./access.js";
import { collectZipEntries, sendZip } from "./zip.js";

// Unlock attempts are limited like logins: 5 failures per IP and share in 15 minutes.
const UNLOCK_WINDOW_MS = 15 * 60 * 1000;
const UNLOCK_MAX_FAILURES = 5;

/**
 * Drop boxes take uploads from anyone with the link, so creations are bounded, whatever their
 * size (an empty file is complete at creation and costs a row, a blob and a feed entry):
 * per visitor address and share, and per share in total.
 */
export const DROP_BOX_CREATE_PER_IP = { max: 100, windowMs: 60 * 60 * 1000 } as const;
export const DROP_BOX_CREATE_PER_SHARE = { max: 1000, windowMs: 24 * 60 * 60 * 1000 } as const;

const folderQuery = z.object({ folderId: z.string().min(1).optional() });

function toPublicNode(node: FileNode): PublicNode {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    size: node.size,
    mime: node.mime,
    updatedAt: node.updatedAt,
  };
}

export interface PublicShares {
  /** Mounted under /api/public/shares after the JSON parser. */
  router: Router;
  /** The tus endpoint of drop boxes; mounted before the JSON parser, tus owns its bodies. */
  uploads: RequestHandler;
}

export function createPublicShares(opts: {
  db: Db;
  config: Config;
  now: () => number;
  uploads: UploadService;
}): PublicShares {
  const { db, config, now, uploads } = opts;
  const access = createShareAccess({ db, config, now });
  const unlockLimiter = createRateLimiter({
    max: UNLOCK_MAX_FAILURES,
    windowMs: UNLOCK_WINDOW_MS,
    now,
  });
  const createPerIp = createRateLimiter({ ...DROP_BOX_CREATE_PER_IP, now });
  const createPerShare = createRateLimiter({ ...DROP_BOX_CREATE_PER_SHARE, now });
  const router = Router();

  // The token is part of every URL here: never leak it through Referer, never cache the answers.
  router.use((_req, res, next) => {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  /** A folder share that lists and serves content: not a file share, not a drop box. */
  function browsable(resolved: ResolvedShare): void {
    if (resolved.share.kind !== "folder" || resolved.share.allowUpload) {
      throw new HttpError(404, "not_found");
    }
  }

  router.get("/:token", (req, res) => {
    const resolved = access.resolve(req.params.token);
    const { share, target } = resolved;
    const unlocked = access.isUnlocked(req, resolved);
    const node = unlocked ? getNode(db, target.id) : undefined;
    const body: PublicShareInfo = {
      // Nothing about a password-protected item is revealed before the password is given.
      name: node?.name ?? "",
      kind: share.kind,
      allowUpload: share.allowUpload,
      requiresPassword: share.passwordHash !== null,
      unlocked,
      size: share.kind === "file" && node ? node.size : null,
      mime: share.kind === "file" && node ? node.mime : null,
      expiresAt: share.expiresAt?.toISOString() ?? null,
    };
    res.json(body);
  });

  router.post("/:token/unlock", async (req, res) => {
    const resolved = access.resolve(req.params.token);
    const { password } = unlockShareRequest.parse(req.body);
    const { share } = resolved;
    if (share.passwordHash === null) {
      res.status(204).end();
      return;
    }
    const key = `${req.ip ?? "unknown"}|${share.id}`;
    // Counted before the Argon2 await: parallel guesses must not all pass a not-yet-failed check.
    unlockLimiter.begin(key);
    if (!(await verifyPassword(share.passwordHash, password))) {
      throw new HttpError(401, "invalid_credentials");
    }
    unlockLimiter.clear(key);
    access.issueGrant(res, req.params.token, share.id);
    res.status(204).end();
  });

  router.get("/:token/content", (req, res) => {
    const resolved = access.resolve(req.params.token);
    const { target } = resolved;
    if (target.kind !== "file" || !target.currentVersionId) throw new HttpError(404, "not_found");
    access.requireUnlocked(req, resolved);
    const version = findVersion(db, target.ownerId, target.id, target.currentVersionId);
    sendBlob(config.dataDir, req, res, target, version);
  });

  router.get("/:token/folder", (req, res) => {
    const resolved = access.resolve(req.params.token);
    browsable(resolved);
    access.requireUnlocked(req, resolved);
    const query = folderQuery.parse(req.query);
    const folder = access.requireInside(resolved, query.folderId ?? resolved.target.id, "folder");
    const body: PublicFolderListing = {
      folder: toPublicNode(getNode(db, folder.id)),
      breadcrumbs: access.chainFromShare(resolved, folder.id),
      children: listChildren(db, folder.ownerId, folder.id).map(toPublicNode),
    };
    res.json(body);
  });

  router.get("/:token/files/:id/content", (req, res) => {
    const resolved = access.resolve(req.params.token);
    browsable(resolved);
    access.requireUnlocked(req, resolved);
    const file = access.requireInside(resolved, req.params.id, "file");
    if (!file.currentVersionId) throw new HttpError(404, "not_found");
    sendBlob(
      config.dataDir,
      req,
      res,
      file,
      findVersion(db, file.ownerId, file.id, file.currentVersionId),
    );
  });

  router.get("/:token/zip", async (req, res) => {
    const resolved = access.resolve(req.params.token);
    browsable(resolved);
    access.requireUnlocked(req, resolved);
    const query = folderQuery.parse(req.query);
    const folder = access.requireInside(resolved, query.folderId ?? resolved.target.id, "folder");
    const entries = collectZipEntries(db, config.dataDir, folder.ownerId, folder.id);
    await sendZip(res, folder.name, entries, { headOnly: req.method === "HEAD" });
  });

  const uploadHandler: RequestHandler = (req, res, next) => {
    void (async () => {
      const token = String(req.params.token);
      const resolved = access.resolve(token);
      if (!resolved.share.allowUpload) throw new HttpError(404, "not_found");
      access.requireUnlocked(req, resolved);
      // Every creation counts, accepted or not: refused ones cost the server work too. Both
      // limits are checked before either is charged, so a refusal never uses up the other.
      if (req.method === "POST") {
        const ipKey = `${req.ip ?? "unknown"}|${resolved.share.id}`;
        createPerIp.check(ipKey);
        createPerShare.check(resolved.share.id);
        createPerIp.begin(ipKey);
        createPerShare.begin(resolved.share.id);
      }
      const owner = db.select().from(users).where(eq(users.id, resolved.share.ownerId)).get();
      if (!owner) throw new HttpError(404, "not_found");
      res.setHeader("Referrer-Policy", "no-referrer");
      await uploads.serve(
        {
          owner: toUser(owner),
          path: `${publicSharePath(token)}/uploads`,
          share: { id: resolved.share.id, folderId: resolved.target.id },
        },
        req,
        res,
      );
    })().catch(next);
  };

  return { router, uploads: uploadHandler };
}
