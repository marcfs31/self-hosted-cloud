import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { constants } from "node:fs";
import { copyFile, mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { THUMBNAIL_SIZES } from "@cloud/shared";

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

/** <dataDir>/thumbs/<versionId[0..2]>/<versionId>-<size>.webp; the size is one of THUMBNAIL_SIZES. */
export function thumbPath(dataDir: string, versionId: string, size: number): string {
  const version = assertUuid(versionId);
  if (!(THUMBNAIL_SIZES as readonly number[]).includes(size)) {
    throw new Error("storage: unsupported thumbnail size");
  }
  return resolve(join(dataDir, "thumbs", version.slice(0, 2), `${version}-${size}.webp`));
}

export function uploadsDir(dataDir: string): string {
  return resolve(join(dataDir, "tmp", "uploads"));
}

/** Where @tus/file-store keeps the bytes of an unfinished upload. */
export function uploadTempPath(dataDir: string, uploadId: string): string {
  return join(uploadsDir(dataDir), assertUuid(uploadId));
}

/** Where WebDAV writes the body of a PUT (or the copy of a blob) until commitBlob moves it. */
export function davTempDir(dataDir: string): string {
  return resolve(join(dataDir, "tmp", "dav"));
}

export function davTempPath(dataDir: string, id: string): string {
  return join(davTempDir(dataDir), assertUuid(id));
}

/** Remove WebDAV temp files not modified for `olderThanMs`: leftovers of a crashed process. */
export async function sweepDavTemp(
  dataDir: string,
  olderThanMs: number,
  nowMs: number,
): Promise<void> {
  const directory = davTempDir(dataDir);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const name of names) {
    if (!isUuid(name)) continue;
    const path = join(directory, name);
    const info = await stat(path).catch(() => undefined);
    if (info && nowMs - info.mtimeMs > olderThanMs) await unlinkQuietly(path, "dav temp");
  }
}

/** Copy a stored version's bytes to a new temp path, ready for commitBlob (a WebDAV COPY). */
export async function copyBlobToTemp(
  dataDir: string,
  ownerId: string,
  versionId: string,
  tempPath: string,
): Promise<void> {
  await copyFile(blobPath(dataDir, ownerId, versionId), tempPath, constants.COPYFILE_EXCL);
}

export async function removeDavTemp(dataDir: string, id: string): Promise<void> {
  await unlinkQuietly(davTempPath(dataDir, id), "dav temp");
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

async function unlinkQuietly(path: string, what: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    console.error(`${what} unlink failed:`, (err as NodeJS.ErrnoException).code ?? "unknown");
  }
}

/**
 * Best effort: a failure is logged and never undoes the metadata change that preceded it. The
 * version's cached thumbnails go with its bytes, so every path that drops a blob (purge, version
 * delete, abandoned upload) drops them too.
 */
export async function removeBlob(
  dataDir: string,
  ownerId: string,
  versionId: string,
): Promise<void> {
  await unlinkQuietly(blobPath(dataDir, ownerId, versionId), "blob");
  for (const size of THUMBNAIL_SIZES) {
    await unlinkQuietly(thumbPath(dataDir, versionId, size), "thumbnail");
  }
}
