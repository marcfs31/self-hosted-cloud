import { and, eq, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { changesQuery, type Change, type ChangesPage } from "@cloud/shared";
import { authOf, type SessionService } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { files } from "../db/schema/index.js";
import { getOrCreateRoot, nodeSelect, toFileNode, type Tx } from "../files/tree.js";
import { HttpError } from "../http/errors.js";

// Opaque to clients; versioned so the format can change without ambiguity.
const cursorSchema = z.strictObject({ v: z.literal(1), s: z.int().min(0) });

function encodeCursor(seq: number): string {
  return Buffer.from(JSON.stringify({ v: 1, s: seq })).toString("base64url");
}

/** Strict: anything but a cursor this server issued is rejected, never guessed at. */
function decodeCursor(raw: string): number {
  try {
    const { s } = cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    if (encodeCursor(s) === raw) return s;
  } catch {
    // falls through to the rejection below
  }
  throw new HttpError(400, "invalid_request");
}

/** Highest sequence ever issued (it never decreases, unlike MAX(seq) once rows are cascaded away). */
function issuedUpTo(tx: Tx): number {
  return (
    tx.get<{ seq: number } | undefined>(sql`select seq from sqlite_sequence where name = 'changes'`)
      ?.seq ?? 0
  );
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
  const after = query.cursor === undefined ? 0 : decodeCursor(query.cursor);
  return db.transaction((tx) => {
    if (after > issuedUpTo(tx)) throw new HttpError(400, "invalid_request");
    // A brand-new account has no root yet; the feed must carry it (clients need its ID).
    getOrCreateRoot(tx, ownerId, nowMs);

    // Latest sequence per item, oldest first. Distinct items never share a sequence number.
    const rows = tx.all<{ file_id: string; last_seq: number }>(sql`
      select file_id, max(seq) as last_seq from changes
       where owner_id = ${ownerId} and seq > ${after}
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
