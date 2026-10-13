import type { Db } from "../db/client.js";
import { changes } from "../db/schema/index.js";

// Three bound parameters per row; stays far below SQLite's variable limit.
const CHUNK = 300;

/**
 * Appends a change-feed row for each item. Call it with the transaction that performs the
 * mutation, so the feed can never miss something that committed or announce something that
 * rolled back. Pass every item whose FileNode (or existence) changed; the feed reports each
 * item's latest state, so repeats and over-reporting are harmless, omissions are not.
 */
export function recordChanges(
  tx: Pick<Db, "insert">,
  ownerId: string,
  fileIds: readonly string[],
  nowMs: number,
): void {
  const ids = [...new Set(fileIds)];
  const createdAt = new Date(nowMs);
  for (let i = 0; i < ids.length; i += CHUNK) {
    tx.insert(changes)
      .values(ids.slice(i, i + CHUNK).map((fileId) => ({ ownerId, fileId, createdAt })))
      .run();
  }
}
