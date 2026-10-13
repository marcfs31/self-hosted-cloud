import { eq } from "drizzle-orm";
import { recordActivity } from "../activity/record.js";
import { recordChanges } from "../changes/record.js";
import { files } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";
import {
  activeSiblingNames,
  activeSubtree,
  chainOf,
  requireActive,
  type FileRow,
  type Tx,
} from "./tree.js";

/** Create a folder under an active parent; 409 name_conflict when an active sibling has the name. */
export function createFolder(
  tx: Tx,
  ownerId: string,
  parentId: string,
  name: string,
  at: number,
): string {
  requireActive(tx, ownerId, parentId, "folder");
  if (activeSiblingNames(tx, parentId).has(name)) throw new HttpError(409, "name_conflict");
  const when = new Date(at);
  const id = crypto.randomUUID();
  tx.insert(files)
    .values({ id, ownerId, parentId, name, kind: "folder", createdAt: when, updatedAt: when })
    .run();
  recordChanges(tx, ownerId, [id], at);
  return id;
}

/**
 * Rename and/or move an active item. 409 invalid_move for the root and for a move into itself
 * or a descendant, 409 name_conflict when the target name is taken. Nothing is written (and no
 * change recorded) when neither name nor parent differ.
 */
export function relocateItem(
  tx: Tx,
  ownerId: string,
  item: FileRow,
  target: { parentId?: string | undefined; name?: string | undefined },
  at: number,
): void {
  if (item.parentId === null) throw new HttpError(409, "invalid_move");
  const targetParentId = target.parentId ?? item.parentId;
  const name = target.name ?? item.name;
  if (target.parentId !== undefined) {
    requireActive(tx, ownerId, target.parentId, "folder");
    // The target's chain passes through the item exactly when the target is inside the item.
    if (chainOf(tx, target.parentId).some((entry) => entry.id === item.id)) {
      throw new HttpError(409, "invalid_move");
    }
  }
  if (targetParentId === item.parentId && name === item.name) return;
  if (activeSiblingNames(tx, targetParentId).has(name)) throw new HttpError(409, "name_conflict");
  tx.update(files)
    .set({ name, parentId: targetParentId, updatedAt: new Date(at) })
    .where(eq(files.id, item.id))
    .run();
  recordChanges(tx, ownerId, [item.id], at);
}

/**
 * Move an item to the trash. Descendants stay unmarked but become inactive, so the change feed
 * gets a row for each of them. 409 invalid_move for the root.
 */
export function trashItem(
  tx: Tx,
  ownerId: string,
  item: FileRow,
  ctx: { at: number; ip?: string | undefined; via?: string | undefined },
): void {
  if (item.parentId === null) throw new HttpError(409, "invalid_move");
  const affected = activeSubtree(tx, item.id);
  tx.update(files)
    .set({ deletedAt: new Date(ctx.at) })
    .where(eq(files.id, item.id))
    .run();
  recordChanges(tx, ownerId, affected, ctx.at);
  recordActivity(tx, {
    userId: ownerId,
    type: "trash",
    fileId: item.id,
    detail: { name: item.name, kind: item.kind, ...(ctx.via !== undefined && { via: ctx.via }) },
    ip: ctx.ip,
    at: ctx.at,
  });
}
