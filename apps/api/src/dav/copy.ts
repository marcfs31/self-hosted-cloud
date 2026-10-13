import { mkdir } from "node:fs/promises";
import type { User } from "@cloud/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { commitFileVersion } from "../files/commit.js";
import type { InFlightLedger } from "../files/in-flight.js";
import { findVersion } from "../files/content.js";
import { createFolder, trashItem } from "../files/mutations.js";
import {
  commitBlob,
  copyBlobToTemp,
  davTempDir,
  davTempPath,
  removeBlob,
  removeDavTemp,
  type CommittedBlob,
} from "../files/storage.js";
import { getOrCreateRoot, listChildren, usedBytes, type FileRow, type Tx } from "../files/tree.js";
import { DavError } from "./errors.js";
import { copyDeadProperties } from "./properties.js";
import { childOf, resolve, resolveParent } from "./resolve.js";

interface PlanNode {
  /** The source file or folder; its dead properties go to the copy. */
  sourceId: string;
  kind: "file" | "folder";
  name: string;
  /** Files: the version whose bytes are copied. */
  sourceVersionId: string | undefined;
  size: number;
  /** Files: filled in once the bytes are copied to their new blob. */
  newVersionId: string | undefined;
  blob: CommittedBlob | undefined;
  children: PlanNode[];
}

export interface CopyRequest {
  db: Db;
  config: Config;
  now: () => number;
  user: User;
  ip: string | undefined;
  ledger: InFlightLedger;
  src: readonly string[];
  dst: readonly string[];
  overwrite: boolean;
  /** Depth: 0 on a collection copies the collection only. */
  shallow: boolean;
}

function plan(tx: Tx, ownerId: string, row: FileRow, name: string, shallow: boolean): PlanNode {
  const node: PlanNode = {
    sourceId: row.id,
    kind: row.kind,
    name,
    sourceVersionId: undefined,
    size: 0,
    newVersionId: undefined,
    blob: undefined,
    children: [],
  };
  if (row.kind === "file") {
    if (!row.currentVersionId) throw new DavError(404);
    const version = findVersion(tx, ownerId, row.id, row.currentVersionId);
    node.sourceVersionId = version.id;
    node.size = version.size;
  } else if (!shallow) {
    for (const child of listChildren(tx, ownerId, row.id)) {
      const childRow = childOf(tx, ownerId, row.id, child.name);
      if (childRow) node.children.push(plan(tx, ownerId, childRow, child.name, false));
    }
  }
  return node;
}

function filesOf(node: PlanNode): PlanNode[] {
  return node.kind === "file" ? [node] : node.children.flatMap(filesOf);
}

/** Resolve source and destination parent, and decide what happens to an existing destination. */
function prepare(tx: Tx, req: CopyRequest) {
  const root = getOrCreateRoot(tx, req.user.id, req.now());
  const item = resolve(tx, req.user.id, root, req.src);
  if (!item) throw new DavError(404);
  const parent = resolveParent(tx, req.user.id, root, req.dst);
  const name = req.dst.at(-1);
  if (!parent || name === undefined) throw new DavError(409);
  const existing = childOf(tx, req.user.id, parent.id, name);
  if (existing && !req.overwrite) throw new DavError(412);
  return { item, parent, name, existing };
}

/**
 * COPY: a new item (a file with one version, or a collection with everything below it) at the
 * destination. File bytes are copied to temp files and committed as new blobs exactly like an
 * upload, then all metadata is written in one transaction; if that fails the new blobs are
 * removed again. Quota is checked for the whole copy before any byte moves. An existing
 * destination is trashed first (Overwrite: T). Returns true when one was replaced.
 */
export async function copyTree(req: CopyRequest): Promise<boolean> {
  const { db, config, user, ledger } = req;
  const prepared = req.db.transaction((tx) => {
    const p = prepare(tx, req);
    return { tree: plan(tx, user.id, p.item, p.name, req.shallow), used: usedBytes(tx, user.id) };
  });
  const toCopy = filesOf(prepared.tree);
  const total = toCopy.reduce((sum, f) => sum + f.size, 0);
  // The whole copy is reserved before any byte moves, beside every other transfer in flight.
  if (prepared.used + ledger.ownBytes(user.id) + total > user.quotaBytes) throw new DavError(507);
  const reservationId = crypto.randomUUID();
  ledger.transfers.set(reservationId, { ownerId: user.id, size: total, touchedAt: req.now() });

  const committed: { versionId: string }[] = [];
  try {
    await mkdir(davTempDir(config.dataDir), { recursive: true });
    for (const file of toCopy) {
      const tempId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      try {
        await copyBlobToTemp(
          config.dataDir,
          user.id,
          file.sourceVersionId ?? "",
          davTempPath(config.dataDir, tempId),
        );
        file.blob = await commitBlob(
          config.dataDir,
          user.id,
          versionId,
          davTempPath(config.dataDir, tempId),
        );
        file.newVersionId = versionId;
        committed.push({ versionId });
      } finally {
        await removeDavTemp(config.dataDir, tempId);
      }
    }
    return db.transaction((tx) => {
      const { parent, name, existing } = prepare(tx, req);
      if (usedBytes(tx, user.id) + total > user.quotaBytes) throw new DavError(507);
      const at = req.now();
      if (existing) trashItem(tx, user.id, existing, { at, ip: req.ip, via: "webdav" });
      const build = (parentId: string, node: PlanNode): void => {
        if (node.kind === "folder") {
          const id = createFolder(tx, user.id, parentId, node.name, at);
          copyDeadProperties(tx, node.sourceId, id);
          for (const child of node.children) build(id, child);
        } else if (node.blob && node.newVersionId) {
          const id = commitFileVersion(tx, {
            ownerId: user.id,
            parentId,
            filename: node.name,
            versionId: node.newVersionId,
            blob: node.blob,
            at,
            ip: req.ip,
            via: "webdav",
            quotaChecked: true,
            exactName: true,
          });
          copyDeadProperties(tx, node.sourceId, id);
        }
      };
      build(parent.id, { ...prepared.tree, name });
      return existing !== undefined;
    });
  } catch (err) {
    for (const { versionId } of committed) await removeBlob(config.dataDir, user.id, versionId);
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new DavError(404);
    throw err;
  } finally {
    ledger.transfers.delete(reservationId);
  }
}
