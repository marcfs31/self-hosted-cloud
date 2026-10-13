import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Breadcrumb, FileKind, FileNode } from "@cloud/shared";
import type { Db } from "../db/client.js";
import { fileVersions, files } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";

/** A database handle or an open transaction. */
export type Tx = Pick<Db, "select" | "insert" | "update" | "delete" | "all" | "get" | "run">;

export type FileRow = typeof files.$inferSelect;
export type VersionRow = typeof fileVersions.$inferSelect;

export interface ChainEntry {
  id: string;
  name: string;
  deletedAt: number | null;
}

/**
 * The item followed by each ancestor up to the root. The single recursive query behind every
 * "is this active" and "where is this" question; trashing marks only the top item, so an item is
 * active exactly when nothing in its chain has deleted_at set.
 */
export function chainOf(tx: Tx, id: string): ChainEntry[] {
  const rows = tx.all<{ id: string; name: string; deleted_at: number | null }>(sql`
    with recursive chain(id, parent_id, name, deleted_at, depth) as (
      select id, parent_id, name, deleted_at, 0 from files where id = ${id}
      union all
      select f.id, f.parent_id, f.name, f.deleted_at, c.depth + 1
        from files f join chain c on f.id = c.parent_id
       where c.depth < 4096
    )
    select id, name, deleted_at from chain order by depth asc`);
  return rows.map((r) => ({ id: r.id, name: r.name, deletedAt: r.deleted_at }));
}

export function isActive(tx: Tx, id: string): boolean {
  const chain = chainOf(tx, id);
  return chain.length > 0 && chain.every((entry) => entry.deletedAt === null);
}

export function findOwned(tx: Tx, ownerId: string, id: string): FileRow | undefined {
  return tx
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.ownerId, ownerId)))
    .get();
}

/** The caller's non-trashed item of the given kind, or 404 (missing, foreign and trashed alike). */
export function requireActive(tx: Tx, ownerId: string, id: string, kind?: FileKind): FileRow {
  const row = findOwned(tx, ownerId, id);
  if (!row || (kind !== undefined && row.kind !== kind) || !isActive(tx, id)) {
    throw new HttpError(404, "not_found");
  }
  return row;
}

/** A top-level trashed item of the caller, or 404. */
export function requireTrashed(tx: Tx, ownerId: string, id: string): FileRow {
  const row = findOwned(tx, ownerId, id);
  if (!row || row.deletedAt === null) throw new HttpError(404, "not_found");
  return row;
}

function findRoot(tx: Tx, ownerId: string): FileRow | undefined {
  return tx
    .select()
    .from(files)
    .where(and(eq(files.ownerId, ownerId), isNull(files.parentId)))
    .get();
}

/** Race-safe: the unique "one root per owner" index decides, a losing insert is a no-op. */
export function getOrCreateRoot(tx: Tx, ownerId: string, nowMs: number): FileRow {
  const existing = findRoot(tx, ownerId);
  if (existing) return existing;
  const at = new Date(nowMs);
  tx.insert(files)
    .values({
      id: crypto.randomUUID(),
      ownerId,
      parentId: null,
      name: "",
      kind: "folder",
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing()
    .run();
  const created = findRoot(tx, ownerId);
  if (!created) throw new Error("root folder could not be created");
  return created;
}

export function activeSiblingNames(tx: Tx, parentId: string): Set<string> {
  const rows = tx
    .select({ name: files.name })
    .from(files)
    .where(and(eq(files.parentId, parentId), isNull(files.deletedAt)))
    .all();
  return new Set(rows.map((r) => r.name));
}

/** Quota usage: every version of the owner counts, trashed ones included. Never stored. */
export function usedBytes(tx: Tx, ownerId: string): number {
  const row = tx
    .select({ n: sql<number>`coalesce(sum(${fileVersions.size}), 0)`.mapWith(Number) })
    .from(fileVersions)
    .where(eq(fileVersions.ownerId, ownerId))
    .get();
  return row?.n ?? 0;
}

function nodeSelect(tx: Tx) {
  return tx
    .select({
      file: files,
      size: fileVersions.size,
      mime: fileVersions.mime,
      versionCount:
        sql<number>`(select count(*) from file_versions v where v.file_id = ${files.id})`.mapWith(
          Number,
        ),
    })
    .from(files)
    .leftJoin(fileVersions, eq(fileVersions.id, files.currentVersionId));
}

type NodeRow = ReturnType<ReturnType<typeof nodeSelect>["all"]>[number];

function toFileNode(r: NodeRow): FileNode {
  const isFile = r.file.kind === "file";
  return {
    id: r.file.id,
    parentId: r.file.parentId,
    name: r.file.name,
    kind: r.file.kind,
    size: r.size ?? 0,
    mime: r.mime ?? null,
    currentVersionId: isFile ? r.file.currentVersionId : null,
    versionCount: isFile ? r.versionCount : 0,
    createdAt: r.file.createdAt.toISOString(),
    updatedAt: r.file.updatedAt.toISOString(),
    deletedAt: r.file.deletedAt?.toISOString() ?? null,
  };
}

export function getNode(tx: Tx, id: string): FileNode {
  const row = nodeSelect(tx).where(eq(files.id, id)).get();
  if (!row) throw new HttpError(404, "not_found");
  return toFileNode(row);
}

/** Folders first, then files; each group by name, case-insensitively. */
export function listChildren(tx: Tx, ownerId: string, folderId: string): FileNode[] {
  const rows = nodeSelect(tx)
    .where(and(eq(files.parentId, folderId), eq(files.ownerId, ownerId), isNull(files.deletedAt)))
    .all();
  return rows
    .map(toFileNode)
    .sort(
      (a, b) =>
        Number(b.kind === "folder") - Number(a.kind === "folder") ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
}

export function trashedNodes(tx: Tx, ownerId: string): FileNode[] {
  return nodeSelect(tx)
    .where(and(eq(files.ownerId, ownerId), isNotNull(files.deletedAt)))
    .orderBy(desc(files.deletedAt), sql`"files".rowid desc`)
    .all()
    .map(toFileNode);
}

export function breadcrumbsOf(tx: Tx, id: string): Breadcrumb[] {
  return chainOf(tx, id)
    .map(({ id: entryId, name }) => ({ id: entryId, name }))
    .reverse();
}
