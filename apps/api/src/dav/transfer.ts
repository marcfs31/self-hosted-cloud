import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import type { User } from "@cloud/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { commitFileVersion } from "../files/commit.js";
import {
  commitBlob,
  davTempDir,
  davTempPath,
  removeBlob,
  removeDavTemp,
} from "../files/storage.js";
import { getOrCreateRoot, usedBytes, type FileRow } from "../files/tree.js";
import { DavError } from "./errors.js";
import { childOf, resolveParent } from "./resolve.js";

const WRITE_BUFFER = 1024 * 1024;

/**
 * Stream a request body to `path`, refusing with 507 as soon as it is longer than `maxBytes`.
 * Done by hand rather than with pipeline(): a failing pipeline destroys the request, and with it
 * the socket the 507 has to travel on.
 */
function receiveBody(req: IncomingMessage, path: string, maxBytes: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(path, { flags: "wx", mode: 0o600, highWaterMark: WRITE_BUFFER });
    let received = 0;
    let settled = false;
    const stop = (err: Error): void => {
      if (settled) return;
      settled = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("close", onClose);
      req.pause();
      out.destroy();
      reject(err);
    };
    const onData = (chunk: Buffer): void => {
      received += chunk.length;
      if (received > maxBytes) {
        stop(new DavError(507));
      } else if (!out.write(chunk)) {
        req.pause();
        out.once("drain", () => {
          req.resume();
        });
      }
    };
    const onEnd = (): void => {
      out.end();
    };
    const onClose = (): void => {
      if (!req.complete) stop(new Error("request aborted"));
    };
    out.once("finish", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    out.once("error", stop);
    req.once("error", stop);
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("close", onClose);
  });
}

export type Body =
  { kind: "request"; req: IncomingMessage; declaredLength: number | undefined } | { kind: "empty" };

export interface StoreContext {
  db: Db;
  config: Config;
  now: () => number;
  user: User;
  ip: string | undefined;
}

/**
 * Write a file at `segments`: a new file, or a new version when one is already there. The body
 * lands in a temp file under DATA_DIR/tmp/dav, then goes through the same blob commit and
 * metadata transaction as a tus upload. `check` sees the existing item (if any) before a byte
 * is read, and decides the preconditions (locks, If-Match) that depend on it.
 * Throws DavError: 405 for a collection or the root, 409 when the parent is missing, 507 over quota.
 */
export async function storeFile(
  ctx: StoreContext,
  segments: readonly string[],
  body: Body,
  check: (existing: FileRow | undefined) => void,
): Promise<{ created: boolean; versionId: string }> {
  const { db, config, now, user, ip } = ctx;
  const name = segments.at(-1);
  if (name === undefined) throw new DavError(405);
  const parent = resolveParent(db, user.id, getOrCreateRoot(db, user.id, now()), segments);
  if (!parent) throw new DavError(409);
  const existing = childOf(db, user.id, parent.id, name);
  if (existing?.kind === "folder") throw new DavError(405);
  check(existing);

  const remaining = user.quotaBytes - usedBytes(db, user.id);
  if (
    body.kind === "request" &&
    body.declaredLength !== undefined &&
    body.declaredLength > remaining
  ) {
    throw new DavError(507);
  }

  const tempId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const tempPath = davTempPath(config.dataDir, tempId);
  await mkdir(davTempDir(config.dataDir), { recursive: true });
  try {
    if (body.kind === "request") await receiveBody(body.req, tempPath, remaining);
    else await writeFile(tempPath, "", { flag: "wx", mode: 0o600 });
    const blob = await commitBlob(config.dataDir, user.id, versionId, tempPath);
    try {
      const created = db.transaction((tx) => {
        // Re-resolved: the tree may have changed while the body was arriving.
        const where = resolveParent(tx, user.id, getOrCreateRoot(tx, user.id, now()), segments);
        if (!where) throw new DavError(409);
        const current = childOf(tx, user.id, where.id, name);
        if (current?.kind === "folder") throw new DavError(405);
        commitFileVersion(tx, {
          ownerId: user.id,
          parentId: where.id,
          filename: name,
          replaceId: current?.id,
          versionId,
          blob,
          at: now(),
          ip,
          via: "webdav",
          exactName: true,
        });
        return current === undefined;
      });
      return { created, versionId };
    } catch (err) {
      await removeBlob(config.dataDir, user.id, versionId);
      throw err;
    }
  } finally {
    await removeDavTemp(config.dataDir, tempId);
  }
}
