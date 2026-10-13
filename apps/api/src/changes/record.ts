import { eq, max } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { changes } from "../db/schema/index.js";

// Four bound parameters per row; stays far below SQLite's variable limit.
const CHUNK = 200;

/**
 * Appends a change-feed row for each item. Call it with the transaction that performs the
 * mutation, so the feed can never miss something that committed or announce something that
 * rolled back. Pass every item whose FileNode (or existence) changed; the feed reports each
 * item's latest state, so repeats and over-reporting are harmless, omissions are not.
 *
 * Each row also gets the owner's next sequence number (max + 1). That is only safe inside the
 * mutation's transaction, which serialises writers; the unique (owner_id, owner_seq) index
 * turns any breach of that rule into a failure instead of a duplicated cursor position.
 */
export function recordChanges(
  tx: Pick<Db, "insert" | "select">,
  ownerId: string,
  fileIds: readonly string[],
  nowMs: number,
): void {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return;
  const createdAt = new Date(nowMs);
  const last = tx
    .select({ value: max(changes.ownerSeq) })
    .from(changes)
    .where(eq(changes.ownerId, ownerId))
    .get();
  const base = last?.value ?? 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    tx.insert(changes)
      .values(
        ids.slice(i, i + CHUNK).map((fileId, j) => ({
          ownerId,
          fileId,
          createdAt,
          ownerSeq: base + i + j + 1,
        })),
      )
      .run();
  }
}
