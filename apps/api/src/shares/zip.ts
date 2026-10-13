import { createReadStream, type ReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { sql } from "drizzle-orm";
import type { Response } from "express";
import { ZipFile } from "yazl";
import { fileName } from "@cloud/shared";
import type { Db } from "../db/client.js";
import { blobPath } from "../files/storage.js";
import { HttpError } from "../http/errors.js";

export interface ZipEntry {
  /** Relative to the zipped folder, '/'-joined from validated names. */
  path: string;
  kind: "file" | "folder";
  /** Files only. */
  blob?: { file: string; size: number };
  mtime: Date;
}

interface Row {
  id: string;
  parent_id: string;
  name: string;
  kind: "file" | "folder";
  updated_at: number;
  version_id: string | null;
  size: number | null;
}

const MAX_DEPTH = 4096;

function corrupt(reason: string): HttpError {
  console.error("zip: inconsistent tree:", reason);
  return new HttpError(500, "internal");
}

/**
 * Every active entry below `folderId`, parents before children. A trashed child hides its whole
 * subtree (the recursion stops at it); empty folders become directory entries of their own.
 */
export function collectZipEntries(
  db: Db,
  dataDir: string,
  ownerId: string,
  folderId: string,
): ZipEntry[] {
  const rows = db.all<Row>(sql`
    with recursive sub(id, parent_id, name, kind, current_version_id, updated_at, depth) as (
      select id, parent_id, name, kind, current_version_id, updated_at, 1
        from files
       where parent_id = ${folderId} and owner_id = ${ownerId} and deleted_at is null
      union all
      select f.id, f.parent_id, f.name, f.kind, f.current_version_id, f.updated_at, s.depth + 1
        from files f join sub s on f.parent_id = s.id
       where f.owner_id = ${ownerId} and f.deleted_at is null and s.depth < ${MAX_DEPTH}
    )
    select s.id, s.parent_id, s.name, s.kind, s.updated_at, v.id as version_id, v.size
      from sub s
      left join file_versions v
        on v.id = s.current_version_id and v.file_id = s.id and v.owner_id = ${ownerId}`);

  const byId = new Map(rows.map((row) => [row.id, row]));
  const parents = new Set(rows.map((row) => row.parent_id));
  const paths = new Map<string, string>();

  function pathOf(row: Row): string {
    const known = paths.get(row.id);
    if (known !== undefined) return known;
    const name = fileName.safeParse(row.name);
    if (!name.success) throw corrupt("invalid name");
    const parent = byId.get(row.parent_id);
    const path = parent ? `${pathOf(parent)}/${name.data}` : name.data;
    paths.set(row.id, path);
    return path;
  }

  const entries: ZipEntry[] = [];
  for (const row of rows) {
    const mtime = new Date(row.updated_at);
    if (row.kind === "folder") {
      if (!parents.has(row.id)) entries.push({ path: pathOf(row), kind: "folder", mtime });
      continue;
    }
    if (row.size === null || row.version_id === null) {
      throw corrupt("file without a current version");
    }
    entries.push({
      path: pathOf(row),
      kind: "file",
      blob: { file: blobPath(dataDir, ownerId, row.version_id), size: row.size },
      mtime,
    });
  }
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** A missing or resized blob is found before the first byte is sent, while a JSON error still fits. */
async function checkBlobs(entries: ZipEntry[]): Promise<void> {
  for (const entry of entries) {
    if (!entry.blob) continue;
    const found = await stat(entry.blob.file).catch(() => undefined);
    if (found?.size !== entry.blob.size) throw corrupt("blob missing or resized");
  }
}

/** Check the blobs, then stream: a problem found early is still a clean JSON error. */
export async function sendZip(
  res: Response,
  name: string,
  entries: ZipEntry[],
  opts: { headOnly?: boolean } = {},
): Promise<void> {
  await checkBlobs(entries);
  await streamZip(res, name, entries, opts);
}

/**
 * Stream a store-only zip (zip64 when needed, by yazl) of `entries` as the response. Files are
 * opened one at a time. Once the first byte is out a failure cannot become an error response, so
 * it destroys the socket: the client sees an aborted download, never a complete-looking one.
 */
export async function streamZip(
  res: Response,
  name: string,
  entries: ZipEntry[],
  opts: { headOnly?: boolean } = {},
): Promise<void> {
  res.attachment(`${name}.zip`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-cache");
  if (opts.headOnly) {
    res.end();
    return;
  }

  const zip = new ZipFile();
  const open = new Set<ReadStream>();
  for (const entry of entries) {
    if (!entry.blob) {
      zip.addEmptyDirectory(entry.path, { mtime: entry.mtime });
      continue;
    }
    const { file, size } = entry.blob;
    zip.addReadStreamLazy(entry.path, { compress: false, size, mtime: entry.mtime }, (cb) => {
      const stream = createReadStream(file);
      open.add(stream);
      // yazl listens for errors of addFile() streams only: forward ours to the archive.
      stream.once("error", (err) => zip.emit("error", err));
      stream.once("close", () => open.delete(stream));
      cb(null, stream);
    });
  }
  const total = await new Promise<number>((resolve) => {
    zip.end({ forceZip64Format: false, comment: "" }, (...args: unknown[]) => {
      resolve(typeof args[0] === "number" ? args[0] : -1);
    });
  });
  if (total >= 0) res.setHeader("Content-Length", String(total));

  const abort = (err: unknown): void => {
    // A client that simply went away has already destroyed the response; that is not a failure.
    if (!res.destroyed) {
      console.error("zip stream failed:", (err as { code?: string }).code ?? "unknown");
    }
    res.destroy();
  };
  zip.on("error", abort);
  res.once("close", () => {
    for (const stream of open) stream.destroy();
  });
  await pipeline(zip.outputStream, res).catch(abort);
}
