import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

/*
 * The only module that builds filesystem paths for stored data. Paths are made from server-issued
 * UUIDs alone; a file name or any other client string never reaches path.join.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function assertUuid(value: string): string {
  if (!isUuid(value)) throw new Error("storage: identifier is not a UUID");
  return value;
}

/** <dataDir>/files/<ownerId>/<versionId[0..2]>/<versionId> */
export function blobPath(dataDir: string, ownerId: string, versionId: string): string {
  const owner = assertUuid(ownerId);
  const version = assertUuid(versionId);
  return resolve(join(dataDir, "files", owner, version.slice(0, 2), version));
}

export function uploadsDir(dataDir: string): string {
  return resolve(join(dataDir, "tmp", "uploads"));
}

/** Where @tus/file-store keeps the bytes of an unfinished upload. */
export function uploadTempPath(dataDir: string, uploadId: string): string {
  return join(uploadsDir(dataDir), assertUuid(uploadId));
}

export interface CommittedBlob {
  size: number;
  sha256: string;
}

/** Hash, fsync and atomically rename a finished temp file into its final blob path. */
export async function commitBlob(
  dataDir: string,
  ownerId: string,
  versionId: string,
  tempPath: string,
): Promise<CommittedBlob> {
  const target = blobPath(dataDir, ownerId, versionId);
  const hash = createHash("sha256");
  await pipeline(createReadStream(tempPath), async (source) => {
    for await (const chunk of source) hash.update(chunk as Buffer);
  });
  const handle = await open(tempPath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  const { size } = await stat(tempPath);
  await mkdir(dirname(target), { recursive: true });
  await rename(tempPath, target);
  return { size, sha256: hash.digest("hex") };
}

/** Best effort: a failure is logged and never undoes the metadata change that preceded it. */
export async function removeBlob(
  dataDir: string,
  ownerId: string,
  versionId: string,
): Promise<void> {
  try {
    await unlink(blobPath(dataDir, ownerId, versionId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    console.error("blob unlink failed:", (err as NodeJS.ErrnoException).code ?? "unknown");
  }
}
