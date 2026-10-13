import { and, eq, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { changesQuery, type Change, type ChangesPage } from "@cloud/shared";
import { authOf, type SessionService } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { files } from "../db/schema/index.js";
import { getOrCreateRoot, nodeSelect, toFileNode, type Tx } from "../files/tree.js";
import { HttpError } from "../http/errors.js";

/*
 * Cursors are opaque to clients and versioned.
 *   v2 {s}: the position in THIS user's own sequence (changes.owner_seq, 1..n without gaps).
 *   v1 {s}: what servers before 0.17 issued, the global changes.seq. Still accepted so installed
 *           sync clients keep their place; it is translated to the user's own sequence, and the
 *           next page hands back a v2 cursor, so the translation happens once.
 */
const cursorSchema = z.discriminatedUnion("v", [
  z.strictObject({ v: z.literal(1), s: z.int().min(0) }),
  z.strictObject({ v: z.literal(2), s: z.int().min(0) }),
]);
type Cursor = z.infer<typeof cursorSchema>;

function encodeCursor(ownerSeq: number): string {
  return Buffer.from(JSON.stringify({ v: 2, s: ownerSeq })).toString("base64url");
}

/** Strict: anything but a cursor this server issued is rejected, never guessed at. */
function decodeCursor(raw: string): Cursor {
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    if (Buffer.from(JSON.stringify(cursor)).toString("base64url") === raw) return cursor;
  } catch {
    // falls through to the rejection below
  }
  throw new HttpError(400, "invalid_request");
}

/**
 * The owner's sequence position a cursor stands for. A v2 position must not lie beyond what this
 * user has been issued. A v1 position must be 0 or the global seq of one of THIS user's own rows
 * (that is all the old server ever handed out), so probing it cannot reveal how far other users'
 * activity has advanced.
 */
function positionOf(tx: Tx, ownerId: string, cursor: Cursor): number {
  if (cursor.v === 2) {
    const issued =
      tx.get<{ n: number | null }>(
        sql`select max(owner_seq) as n from changes where owner_id = ${ownerId}`,
      ).n ?? 0;
    if (cursor.s > issued) throw new HttpError(400, "invalid_request");
    return cursor.s;
  }
  if (cursor.s === 0) return 0;
  const own = tx.get<{ owner_seq: number } | undefined>(
    sql`select owner_seq from changes where owner_id = ${ownerId} and seq = ${cursor.s}`,
  );
  if (!own) throw new HttpError(400, "invalid_request");
  return own.owner_seq;
}

/** IDs among `ids` that sit under (or are) a trashed item. */
function trashedAmong(tx: Tx, ids: readonly string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const wanted = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = tx.all<{ file_id: string }>(sql`
    with recursive chain(file_id, parent_id, deleted_at, depth) as (
      select id, parent_id, deleted_at, 0 from files where id in (${wanted})
      union all
      select c.file_id, p.parent_id, p.deleted_at, c.depth + 1
        from files p join chain c on p.id = c.parent_id
       where c.depth < 4096
    )
    select file_id from chain group by file_id having count(deleted_at) > 0`);
  return new Set(rows.map((r) => r.file_id));
}

export function listChanges(
  db: Db,
  ownerId: string,
  query: { cursor?: string | undefined; limit: number },
  nowMs: number,
): ChangesPage {
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  return db.transaction((tx) => {
    const after = cursor === undefined ? 0 : positionOf(tx, ownerId, cursor);
    // A brand-new account has no root yet; the feed must carry it (clients need its ID).
    getOrCreateRoot(tx, ownerId, nowMs);

    // Latest sequence per item, oldest first. Distinct items never share a sequence number.
    const rows = tx.all<{ file_id: string; last_seq: number }>(sql`
      select file_id, max(owner_seq) as last_seq from changes
       where owner_id = ${ownerId} and owner_seq > ${after}
       group by file_id order by last_seq asc limit ${query.limit + 1}`);
    const page = rows.slice(0, query.limit);

    const ids = page.map((r) => r.file_id);
    const nodes = new Map(
      ids.length === 0
        ? []
        : nodeSelect(tx)
            .where(and(eq(files.ownerId, ownerId), inArray(files.id, ids)))
            .all()
            .map((row) => [row.file.id, toFileNode(row)] as const),
    );
    const trashed = trashedAmong(tx, ids);

    const changes: Change[] = [];
    for (const { file_id: id } of page) {
      const node = nodes.get(id);
      if (node && !trashed.has(id)) changes.push({ type: "upsert", node });
      // Without a cursor the client has nothing to delete: a snapshot lists what exists.
      else if (query.cursor !== undefined) changes.push({ type: "delete", id });
    }
    return {
      changes,
      cursor: encodeCursor(page.at(-1)?.last_seq ?? after),
      hasMore: rows.length > query.limit,
    };
  });
}

export function createChangesRouter(opts: {
  db: Db;
  sessions: SessionService;
  now: () => number;
}): Router {
  const { db, sessions, now } = opts;
  const router = Router();
  router.get("/", sessions.requireUser, (req, res) => {
    const query = changesQuery.parse(req.query);
    res.json(listChanges(db, authOf(res).user.id, query, now()));
  });
  return router;
}
