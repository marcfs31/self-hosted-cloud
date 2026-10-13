import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import {
  activityPageQuery,
  activityType,
  SECURITY_ACTIVITY_TYPES,
  type ActivityEvent,
  type ActivityPage,
} from "@cloud/shared";
import { authOf, type SessionService } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { activity, users } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";

const cursorSchema = z.object({ t: z.int(), id: z.string() });
const detailSchema = z.record(z.string(), z.string());

function encodeCursor(t: number, id: string): string {
  return Buffer.from(JSON.stringify({ t, id })).toString("base64url");
}

function decodeCursor(raw: string): { t: number; id: string } {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
  } catch {
    throw new HttpError(400, "invalid_request");
  }
}

function parseDetail(raw: string): Record<string, string> {
  try {
    const parsed = detailSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export type ActivityScope = { userId: string } | { securityTypesOfAllUsers: true };

/** Newest first, keyset-paginated by (created_at, id). */
export function listActivity(
  db: Db,
  scope: ActivityScope,
  query: { cursor?: string | undefined; limit: number },
): ActivityPage {
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  const filters = [
    "userId" in scope
      ? eq(activity.userId, scope.userId)
      : inArray(activity.type, [...SECURITY_ACTIVITY_TYPES]),
    cursor &&
      or(
        lt(activity.createdAt, new Date(cursor.t)),
        and(eq(activity.createdAt, new Date(cursor.t)), lt(activity.id, cursor.id)),
      ),
  ];
  const rows = db
    .select({ row: activity, userEmail: users.email })
    .from(activity)
    .innerJoin(users, eq(activity.userId, users.id))
    .where(and(...filters))
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .limit(query.limit + 1)
    .all();
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const events = page.flatMap(({ row, userEmail }): ActivityEvent[] => {
    // A type this version does not know (written by a newer one) is left out, not mislabelled.
    const type = activityType.safeParse(row.type);
    if (!type.success) return [];
    return [
      {
        id: row.id,
        type: type.data,
        createdAt: row.createdAt.toISOString(),
        ip: row.ip,
        userEmail: "userId" in scope ? null : userEmail,
        fileId: row.fileId,
        detail: parseDetail(row.detail),
      },
    ];
  });
  return {
    events,
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor(last.row.createdAt.getTime(), last.row.id)
        : null,
  };
}

export function createActivityRouter(opts: { db: Db; sessions: SessionService }): Router {
  const { db, sessions } = opts;
  const router = Router();
  router.get("/", sessions.requireUser, (req, res) => {
    const query = activityPageQuery.parse(req.query);
    res.json(listActivity(db, { userId: authOf(res).user.id }, query));
  });
  return router;
}
