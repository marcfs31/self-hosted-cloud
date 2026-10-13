import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import type { User } from "@cloud/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { commitFileVersion } from "../files/commit.js";
import type { InFlightLedger } from "../files/in-flight.js";
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

/** The reservation of a body of unknown length grows by this much ahead of what has arrived. */
const RESERVE_STEP = 1024 * 1024;

/**
 * Stream a request body to `path`. `onBytes` sees the running total before each chunk is
 * written and throws (507) to refuse it. Done by hand rather than with pipeline(): a failing
 * pipeline destroys the request, and with it the socket the 507 has to travel on.
 */
function receiveBody(
  req: IncomingMessage,
  path: string,
  onBytes: (received: number) => void,
): Promise<void> {
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
      // Rejected only once closed: an open still pending would otherwise create the temp file
      // after the caller has already removed it.
      out.once("close", () => {
        reject(err);
      });
      out.destroy();
    };
    const onData = (chunk: Buffer): void => {
      received += chunk.length;
      try {
        onBytes(received);
      } catch (err) {
        stop(err instanceof Error ? err : new Error("upload refused"));
        return;
      }
      if (!out.write(chunk)) {
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
  ledger: InFlightLedger;
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
  const { db, config, now, user, ip, ledger } = ctx;
  const name = segments.at(-1);
  if (name === undefined) throw new DavError(405);
  const parent = resolveParent(db, user.id, getOrCreateRoot(db, user.id, now()), segments);
  if (!parent) throw new DavError(409);
  const existing = childOf(db, user.id, parent.id, name);
  if (existing?.kind === "folder") throw new DavError(405);
  check(existing);

  // Reserved before the first byte is read: parallel transfers cannot each see the full headroom.
  const declared = body.kind === "request" ? body.declaredLength : undefined;
  const reservationId = crypto.randomUUID();
  const reservation = { ownerId: user.id, size: 0, touchedAt: now() };
  const room = (): number =>
    user.quotaBytes - usedBytes(db, user.id) - (ledger.ownBytes(user.id) - reservation.size);
  if (declared !== undefined && declared > room()) throw new DavError(507);
  reservation.size = declared ?? 0;
  // Checked and reserved in the same tick (no await in between), so concurrent PUTs cannot both fit.
  ledger.transfers.set(reservationId, reservation);
  const grow = (received: number): void => {
    if (received <= reservation.size) return;
    const available = room();
    if (received > available) throw new DavError(507);
    reservation.size = Math.min(received + RESERVE_STEP, available);
  };

  const tempId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const tempPath = davTempPath(config.dataDir, tempId);
  try {
    await mkdir(davTempDir(config.dataDir), { recursive: true });
    if (body.kind === "request") await receiveBody(body.req, tempPath, grow);
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
    ledger.transfers.delete(reservationId);
    await removeDavTemp(config.dataDir, tempId);
  }
}
