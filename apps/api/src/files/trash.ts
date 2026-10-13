import { sql, type SQL } from "drizzle-orm";
import { TRASH_RETENTION_DAYS } from "@cloud/shared";
import { recordActivity } from "../activity/record.js";
import { recordChanges } from "../changes/record.js";
import type { Db } from "../db/client.js";
import { removeBlob } from "./storage.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface PurgeContext {
  now: () => number;
  /** Set by the retention sweep; user-initiated purges leave it out. */
  reason?: "retention";
  ip?: string | undefined;
}

/**
 * Permanently delete every trashed item matching `where` (a condition on the files table) together
 * with its subtree, in one transaction; unlink the blobs only after it commits. An unlink failure
 * is logged by removeBlob and never brings a row back. The same transaction records one 'purge'
 * activity event per matched item and a change-feed row for every purged ID. Returns how many
 * items were purged.
 */
export async function purgeWhere(
  db: Db,
  dataDir: string,
  where: SQL,
  ctx: PurgeContext,
): Promise<number> {
  const { count, blobs } = db.transaction((tx) => {
    const doomed = sql`
      with recursive subtree(id) as (
        select id from files where ${where}
        union
        select f.id from files f join subtree s on f.parent_id = s.id
      )`;
    const at = ctx.now();
    const matched = tx.all<{ id: string; owner_id: string; name: string; kind: string }>(
      sql`select id, owner_id, name, kind from files where ${where}`,
    );
    const purged = tx.all<{ id: string; owner_id: string }>(sql`
      ${doomed}
      select id, owner_id from files where id in (select id from subtree)`);
    const versions = tx.all<{ id: string; owner_id: string }>(sql`
      ${doomed}
      select id, owner_id from file_versions where file_id in (select id from subtree)`);
    const deleted = tx.run(sql`delete from files where ${where}`);

    const idsByOwner = new Map<string, string[]>();
    for (const row of purged) {
      const ids = idsByOwner.get(row.owner_id) ?? [];
      ids.push(row.id);
      idsByOwner.set(row.owner_id, ids);
    }
    for (const [ownerId, ids] of idsByOwner) recordChanges(tx, ownerId, ids, at);
    for (const item of matched) {
      recordActivity(tx, {
        userId: item.owner_id,
        type: "purge",
        fileId: item.id,
        detail: { name: item.name, kind: item.kind, ...(ctx.reason && { reason: ctx.reason }) },
        ip: ctx.ip,
        at,
      });
    }
    return { count: deleted.changes, blobs: versions };
  });
  for (const v of blobs) await removeBlob(dataDir, v.owner_id, v.id);
  return count;
}

export function purgeItem(
  db: Db,
  dataDir: string,
  ownerId: string,
  id: string,
  ctx: PurgeContext,
): Promise<number> {
  return purgeWhere(
    db,
    dataDir,
    sql`id = ${id} and owner_id = ${ownerId} and deleted_at is not null`,
    ctx,
  );
}

export function purgeAllTrashed(
  db: Db,
  dataDir: string,
  ownerId: string,
  ctx: PurgeContext,
): Promise<number> {
  return purgeWhere(db, dataDir, sql`owner_id = ${ownerId} and deleted_at is not null`, ctx);
}

/** Retention sweep: purge items trashed more than TRASH_RETENTION_DAYS ago. */
export function purgeExpiredTrash(opts: {
  db: Db;
  dataDir: string;
  now: () => number;
}): Promise<number> {
  const cutoff = opts.now() - TRASH_RETENTION_DAYS * DAY_MS;
  return purgeWhere(opts.db, opts.dataDir, sql`deleted_at is not null and deleted_at < ${cutoff}`, {
    now: opts.now,
    reason: "retention",
  });
}
