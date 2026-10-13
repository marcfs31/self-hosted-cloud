import { sql, type SQL } from "drizzle-orm";
import { TRASH_RETENTION_DAYS } from "@cloud/shared";
import type { Db } from "../db/client.js";
import { removeBlob } from "./storage.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Permanently delete every trashed item matching `where` (a condition on the files table) together
 * with its subtree, in one transaction; unlink the blobs only after it commits. An unlink failure
 * is logged by removeBlob and never brings a row back. Returns how many items were purged.
 */
export async function purgeWhere(db: Db, dataDir: string, where: SQL): Promise<number> {
  const { count, blobs } = db.transaction((tx) => {
    const doomed = sql`
      with recursive subtree(id) as (
        select id from files where ${where}
        union
        select f.id from files f join subtree s on f.parent_id = s.id
      )`;
    const versions = tx.all<{ id: string; owner_id: string }>(sql`
      ${doomed}
      select id, owner_id from file_versions where file_id in (select id from subtree)`);
    const deleted = tx.run(sql`delete from files where ${where}`);
    return { count: deleted.changes, blobs: versions };
  });
  for (const v of blobs) await removeBlob(dataDir, v.owner_id, v.id);
  return count;
}

export function purgeItem(db: Db, dataDir: string, ownerId: string, id: string): Promise<number> {
  return purgeWhere(
    db,
    dataDir,
    sql`id = ${id} and owner_id = ${ownerId} and deleted_at is not null`,
  );
}

export function purgeAllTrashed(db: Db, dataDir: string, ownerId: string): Promise<number> {
  return purgeWhere(db, dataDir, sql`owner_id = ${ownerId} and deleted_at is not null`);
}

/** Retention sweep: purge items trashed more than TRASH_RETENTION_DAYS ago. */
export function purgeExpiredTrash(opts: {
  db: Db;
  dataDir: string;
  now: () => number;
}): Promise<number> {
  const cutoff = opts.now() - TRASH_RETENTION_DAYS * DAY_MS;
  return purgeWhere(opts.db, opts.dataDir, sql`deleted_at is not null and deleted_at < ${cutoff}`);
}
