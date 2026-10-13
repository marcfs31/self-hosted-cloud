import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import {
  createShareRequest,
  type CreatedShareResponse,
  type ListSharesResponse,
  type Share,
} from "@cloud/shared";
import { hashPassword } from "../auth/passwords.js";
import { authOf, type SessionService } from "../auth/sessions.js";
import { hashToken, newToken } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { files, shares } from "../db/schema/index.js";
import { requireActive } from "../files/tree.js";
import { HttpError } from "../http/errors.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function toShare(row: typeof shares.$inferSelect, fileName: string): Share {
  return {
    id: row.id,
    fileId: row.fileId,
    fileName,
    kind: row.kind,
    allowUpload: row.allowUpload,
    hasPassword: row.passwordHash !== null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

/** The owner's side of sharing: create, list and revoke links. Everything is scoped to the user. */
export function createSharesRouter(opts: {
  db: Db;
  sessions: SessionService;
  now: () => number;
}): Router {
  const { db, sessions, now } = opts;
  const router = Router();
  router.use("/shares", sessions.requireUser);

  router.post("/shares", async (req, res) => {
    const { user } = authOf(res);
    const body = createShareRequest.parse(req.body);
    // Hashed before any lookup so a foreign ID costs the same as an own one.
    const passwordHash = body.password === undefined ? null : await hashPassword(body.password);
    const token = newToken();
    const created: Share = db.transaction((tx) => {
      const target = requireActive(tx, user.id, body.fileId);
      if (target.parentId === null) throw new HttpError(409, "invalid_move");
      if (body.allowUpload && target.kind !== "folder") throw new HttpError(400, "invalid_request");
      const at = now();
      const row = tx
        .insert(shares)
        .values({
          id: crypto.randomUUID(),
          ownerId: user.id,
          fileId: target.id,
          tokenHash: hashToken(token),
          kind: target.kind,
          allowUpload: body.allowUpload,
          passwordHash,
          expiresAt:
            body.expiresInDays === null ? null : new Date(at + body.expiresInDays * DAY_MS),
          createdAt: new Date(at),
        })
        .returning()
        .get();
      return toShare(row, target.name);
    });
    const response: CreatedShareResponse = { share: created, token };
    res.status(201).json(response);
  });

  router.get("/shares", (_req, res) => {
    const { user } = authOf(res);
    const rows = db
      .select({ share: shares, fileName: files.name })
      .from(shares)
      .innerJoin(files, eq(files.id, shares.fileId))
      .where(and(eq(shares.ownerId, user.id), isNull(shares.revokedAt)))
      .orderBy(desc(shares.createdAt), sql`"shares".rowid desc`)
      .all();
    const body: ListSharesResponse = { shares: rows.map((r) => toShare(r.share, r.fileName)) };
    res.json(body);
  });

  router.delete("/shares/:id", (req, res) => {
    const { user } = authOf(res);
    const revoked = db
      .update(shares)
      .set({ revokedAt: new Date(now()) })
      .where(
        and(eq(shares.id, req.params.id), eq(shares.ownerId, user.id), isNull(shares.revokedAt)),
      )
      .returning({ id: shares.id })
      .all();
    if (revoked.length === 0) throw new HttpError(404, "not_found");
    res.status(204).end();
  });

  return router;
}
