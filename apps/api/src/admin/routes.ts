import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import {
  createInviteRequest,
  updateUserRequest,
  type CreatedInviteResponse,
  type Invite,
  type ListInvitesResponse,
  type ListUsersResponse,
  type User,
} from "@cloud/shared";
import { toUser, authOf, type SessionService } from "../auth/sessions.js";
import { hashToken, newToken } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { fileVersions, invites, users } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function toInvite(row: typeof invites.$inferSelect): Invite {
  return {
    id: row.id,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
  };
}

export function createAdminRouter(opts: {
  db: Db;
  sessions: SessionService;
  now: () => number;
}): Router {
  const { db, sessions, now } = opts;
  const router = Router();
  router.use(sessions.requireUser, sessions.requireRole("admin"));

  router.get("/users", (_req, res) => {
    const rows = db
      .select()
      .from(users)
      .orderBy(asc(users.createdAt), asc(sql`rowid`))
      .all();
    const used = new Map(
      db
        .select({
          ownerId: fileVersions.ownerId,
          n: sql<number>`sum(${fileVersions.size})`.mapWith(Number),
        })
        .from(fileVersions)
        .groupBy(fileVersions.ownerId)
        .all()
        .map((r) => [r.ownerId, r.n]),
    );
    const body: ListUsersResponse = {
      users: rows.map((row) => ({ ...toUser(row), usedBytes: used.get(row.id) ?? 0 })),
    };
    res.json(body);
  });

  router.patch("/users/:id", (req, res) => {
    const patch = updateUserRequest.parse(req.body);
    if (req.params.id === authOf(res).user.id) throw new HttpError(409, "cannot_change_self");
    const row = db
      .update(users)
      .set({
        ...(patch.quotaBytes !== undefined && { quotaBytes: patch.quotaBytes }),
        ...(patch.role !== undefined && { role: patch.role }),
      })
      .where(eq(users.id, req.params.id))
      .returning()
      .all()[0];
    if (!row) throw new HttpError(404, "not_found");
    const body: User = toUser(row);
    res.json(body);
  });

  // Revoked invites are hidden: the contract's Invite has no revoked state.
  router.get("/invites", (_req, res) => {
    const rows = db
      .select()
      .from(invites)
      .where(isNull(invites.revokedAt))
      .orderBy(desc(invites.createdAt), desc(sql`rowid`))
      .all();
    const body: ListInvitesResponse = { invites: rows.map(toInvite) };
    res.json(body);
  });

  router.post("/invites", (req, res) => {
    const { role, expiresInDays } = createInviteRequest.parse(req.body);
    const token = newToken();
    const created = now();
    const row = db
      .insert(invites)
      .values({
        id: crypto.randomUUID(),
        tokenHash: hashToken(token),
        role,
        createdBy: authOf(res).user.id,
        createdAt: new Date(created),
        expiresAt: new Date(created + expiresInDays * DAY_MS),
      })
      .returning()
      .get();
    const body: CreatedInviteResponse = { invite: toInvite(row), token };
    res.status(201).json(body);
  });

  router.delete("/invites/:id", (req, res) => {
    const row = db
      .update(invites)
      .set({ revokedAt: new Date(now()) })
      .where(eq(invites.id, req.params.id))
      .returning({ id: invites.id })
      .all()[0];
    if (!row) throw new HttpError(404, "not_found");
    res.status(204).end();
  });

  return router;
}
