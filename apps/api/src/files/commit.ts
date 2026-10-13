import { eq } from "drizzle-orm";
import { uniqueName } from "@cloud/shared";
import { recordActivity } from "../activity/record.js";
import { recordChanges } from "../changes/record.js";
import { fileVersions, files, users } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";
import { mimeForName } from "./mime.js";
import type { CommittedBlob } from "./storage.js";
import { activeSiblingNames, requireActive, usedBytes, type Tx } from "./tree.js";

export interface FileCommit {
  ownerId: string;
  parentId: string;
  /** The wanted name; a clash with an active sibling gets a " (n)" suffix. Ignored when replacing. */
  filename: string;
  /** Add a new version to this file (it must live in parentId) instead of creating one. */
  replaceId?: string | undefined;
  /** The version ID the blob was committed under (see commitBlob). */
  versionId: string;
  blob: CommittedBlob;
  /** Epoch ms. */
  at: number;
  ip?: string | undefined;
  /** How the bytes arrived, when not through the owner's own session (shown in the activity log). */
  via?: string | undefined;
  /** The caller already proved the whole batch fits the quota (a multi-file copy). */
  quotaChecked?: boolean;
  /** The caller saw that no active sibling has this name in the same transaction: use it as is. */
  exactName?: boolean;
}

/**
 * The one place a finished blob becomes a file or a new version of one: tus uploads and WebDAV
 * writes both end here. Call it inside the transaction that also validates whatever the caller
 * resolved beforehand. Writes the metadata, the change-feed row and the 'upload' activity event
 * together, after the authoritative quota check (413 quota_exceeded). Returns the file's ID.
 */
export function commitFileVersion(tx: Tx, input: FileCommit): string {
  const { ownerId, parentId, filename, replaceId, versionId, blob, at } = input;
  const owner = tx.select().from(users).where(eq(users.id, ownerId)).get();
  if (!owner) throw new HttpError(404, "not_found");
  requireActive(tx, ownerId, parentId, "folder");
  const replaced =
    replaceId === undefined ? undefined : requireActive(tx, ownerId, replaceId, "file");
  if (replaced && replaced.parentId !== parentId) throw new HttpError(404, "not_found");
  if (!input.quotaChecked && usedBytes(tx, ownerId) + blob.size > owner.quotaBytes) {
    throw new HttpError(413, "quota_exceeded");
  }
  const when = new Date(at);
  const fileId = replaced?.id ?? crypto.randomUUID();
  const name =
    replaced?.name ??
    (input.exactName ? filename : uniqueName(filename, activeSiblingNames(tx, parentId)));
  if (replaced) {
    tx.insert(fileVersions)
      .values({ id: versionId, fileId, ownerId, mime: mimeForName(name), createdAt: when, ...blob })
      .run();
    tx.update(files)
      .set({ currentVersionId: versionId, updatedAt: when })
      .where(eq(files.id, fileId))
      .run();
  } else {
    tx.insert(files)
      .values({
        id: fileId,
        ownerId,
        parentId,
        name,
        kind: "file",
        currentVersionId: versionId,
        createdAt: when,
        updatedAt: when,
      })
      .run();
    tx.insert(fileVersions)
      .values({ id: versionId, fileId, ownerId, mime: mimeForName(name), createdAt: when, ...blob })
      .run();
  }
  recordChanges(tx, ownerId, [fileId], at);
  recordActivity(tx, {
    userId: ownerId,
    type: "upload",
    fileId,
    detail: { name, kind: "file", ...(input.via !== undefined && { via: input.via }) },
    ip: input.ip,
    at,
  });
  return fileId;
}
