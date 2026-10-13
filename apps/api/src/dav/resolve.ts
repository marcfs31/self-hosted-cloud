import { and, eq, isNull } from "drizzle-orm";
import type { FileNode } from "@cloud/shared";
import { files } from "../db/schema/index.js";
import type { FileRow, Tx } from "../files/tree.js";
import type { DavResource } from "./props.js";

/**
 * The only way a /dav path meets the database: one name at a time, among the owner's active
 * children of the folder reached so far. A name is data, never a path.
 */
export function childOf(
  tx: Tx,
  ownerId: string,
  parentId: string,
  name: string,
): FileRow | undefined {
  return tx
    .select()
    .from(files)
    .where(
      and(
        eq(files.ownerId, ownerId),
        eq(files.parentId, parentId),
        eq(files.name, name),
        isNull(files.deletedAt),
      ),
    )
    .get();
}

export function resolve(
  tx: Tx,
  ownerId: string,
  root: FileRow,
  segments: readonly string[],
): FileRow | undefined {
  let current = root;
  for (const name of segments) {
    if (current.kind !== "folder") return undefined;
    const next = childOf(tx, ownerId, current.id, name);
    if (!next) return undefined;
    current = next;
  }
  return current;
}

/** The folder that holds (or would hold) the last segment; undefined when it is missing or a file. */
export function resolveParent(
  tx: Tx,
  ownerId: string,
  root: FileRow,
  segments: readonly string[],
): FileRow | undefined {
  const parent = resolve(tx, ownerId, root, segments.slice(0, -1));
  return parent?.kind === "folder" ? parent : undefined;
}

export function toResource(node: FileNode, segments: string[]): DavResource {
  return {
    id: node.id,
    segments,
    collection: node.kind === "folder",
    size: node.size,
    mime: node.mime ?? "application/octet-stream",
    versionId: node.currentVersionId,
    created: new Date(node.createdAt),
    modified: new Date(node.updatedAt),
  };
}
