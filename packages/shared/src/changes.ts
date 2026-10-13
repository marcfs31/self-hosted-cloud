import { z } from "zod";
import { fileNode } from "./files.js";

/*
 * Change feed for sync clients (session or app password; scoped to the user).
 *
 *   GET /changes?cursor=<opaque>&limit=<1..1000, default 500> → ChangesPage
 *
 * Every mutation of the user's files (create, upload, new version, rename, move, trash,
 * restore, purge, version restore/delete — from the web, drop boxes, WebDAV or the CLI)
 * appends to a per-user, strictly increasing sequence in the same transaction as the change.
 * The feed returns, for each item touched after the cursor, only its LATEST state:
 *   - { type: "upsert", node }  the item exists and is active (node is the current FileNode)
 *   - { type: "delete", id }    the item was purged, trashed, or is under a trashed folder
 * Restoring a folder emits upserts for it and every active descendant.
 * No cursor = from the beginning (a full snapshot of active items as upserts, no deletes).
 * Clients apply pages in order and persist `cursor` after each page; `hasMore` means fetch again
 * immediately. Cursors never expire; an unknown or malformed cursor → 400 invalid_request.
 */

export const changesQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type ChangesQuery = z.input<typeof changesQuery>;

export const change = z.discriminatedUnion("type", [
  z.object({ type: z.literal("upsert"), node: fileNode }),
  z.object({ type: z.literal("delete"), id: z.string() }),
]);
export type Change = z.infer<typeof change>;

export const changesPage = z.object({
  changes: z.array(change),
  cursor: z.string(),
  hasMore: z.boolean(),
});
export type ChangesPage = z.infer<typeof changesPage>;
