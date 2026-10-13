import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth.js";

/*
 * The change feed (GET /api/changes): one row per mutation of an item, appended in the same
 * transaction as the mutation. The feed reads only the latest row per file_id, so repeated edits
 * collapse into one entry. file_id is deliberately not a foreign key: a purged item keeps its
 * rows, which is how clients learn it is gone.
 *
 * seq is the global insertion order and is never shown to clients: it would reveal how much the
 * other users do. Cursors carry owner_seq instead, a gap-free 1..n sequence per owner, assigned
 * as max(owner_seq)+1 in the transaction of the mutation (see changes/record.ts). Rows only
 * disappear with their owner, so an owner's maximum never decreases.
 */
export const changes = sqliteTable(
  "changes",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ownerSeq: integer("owner_seq").notNull(),
    fileId: text("file_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("changes_owner_owner_seq_idx").on(t.ownerId, t.ownerSeq)],
);
