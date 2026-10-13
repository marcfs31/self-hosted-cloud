import { Router, type Request, type Response } from "express";
import type { User } from "@cloud/shared";
import type { SessionService } from "../auth/sessions.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { findVersion, sendBlob } from "../files/content.js";
import { createFolder, relocateItem, trashItem } from "../files/mutations.js";
import { sweepDavTemp } from "../files/storage.js";
import { getNode, getOrCreateRoot, listChildren, usedBytes, type FileRow } from "../files/tree.js";
import { createDavAuth } from "./auth.js";
import { copyTree } from "./copy.js";
import { davErrorHandler, DavError, XML_DECLARATION } from "./errors.js";
import { activeLockXml, createLockManager } from "./locks.js";
import { destinationSegments, isBelow, isSamePath, mountedPath, parseSegments } from "./paths.js";
import { multistatus, propfindEntry, proppatchEntry, type PropContext } from "./props.js";
import {
  depthOf,
  hasBody,
  lockTimeoutSeconds,
  lockTokenHeader,
  overwriteAllowed,
  parseLockInfo,
  parsePropertyUpdate,
  parsePropfind,
  readBody,
  submittedTokens,
} from "./requests.js";
import { childOf, resolve, resolveParent, toResource } from "./resolve.js";
import { storeFile } from "./transfer.js";
import type { InFlightLedger } from "../files/in-flight.js";

const METHODS = [
  "OPTIONS",
  "GET",
  "HEAD",
  "PUT",
  "DELETE",
  "PROPFIND",
  "PROPPATCH",
  "MKCOL",
  "COPY",
  "MOVE",
  "LOCK",
  "UNLOCK",
] as const;
const ALLOW = METHODS.join(", ");
const DAY_MS = 24 * 60 * 60 * 1000;

interface Call {
  req: Request;
  res: Response;
  user: User;
  ip: string | undefined;
  /** The request path as names; null when a name is not valid. */
  path: string[] | null;
}

export interface DavService {
  router: Router;
  /** Remove temp files a crashed process left behind. */
  cleanup: () => Promise<void>;
}

function xml(res: Response, status: number, body: string): void {
  res.status(status).type("application/xml; charset=utf-8").send(body);
}

function empty(res: Response, status: number, headers: Record<string, string> = {}): void {
  res.status(status);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.setHeader("Content-Length", "0");
  res.end();
}

/** A path a request reads or removes: a bad name cannot exist, so it is simply not found. */
function existingPath(call: Pick<Call, "path">): string[] {
  if (!call.path) throw new DavError(404);
  return call.path;
}

/** A path a request creates: a bad name is the client's mistake. */
function newPath(call: Pick<Call, "path">): string[] {
  if (!call.path) throw new DavError(400);
  return call.path;
}

function tagsOf(header: string): string[] {
  return header.split(",").map((t) => t.trim().replace(/^W\//, ""));
}

/** If-Match / If-None-Match against the current entity tag (PUT only). */
function checkConditions(req: Request, existing: FileRow | undefined): void {
  const etag = existing?.currentVersionId ? `"${existing.currentVersionId}"` : undefined;
  const ifMatch = req.get("if-match");
  if (ifMatch !== undefined) {
    const tags = tagsOf(ifMatch);
    if (etag === undefined || !(tags.includes("*") || tags.includes(etag))) {
      throw new DavError(412);
    }
  }
  const ifNoneMatch = req.get("if-none-match");
  if (ifNoneMatch !== undefined && existing) {
    const tags = tagsOf(ifNoneMatch);
    if (tags.includes("*") || (etag !== undefined && tags.includes(etag))) throw new DavError(412);
  }
}

export function createDavRouter(opts: {
  db: Db;
  config: Config;
  sessions: SessionService;
  now: () => number;
  ledger: InFlightLedger;
}): DavService {
  const { db, config, sessions, now, ledger } = opts;
  const authenticate = createDavAuth({ sessions, now });
  const locks = createLockManager(now);
  const ownHost = new URL(config.publicOrigin).host.toLowerCase();
  const router = Router();

  const handlers: Record<(typeof METHODS)[number], (call: Call) => void | Promise<void>> = {
    OPTIONS({ res }) {
      empty(res, 200, { Allow: ALLOW });
    },

    async PROPFIND({ req, res, user, path }) {
      const depth = depthOf(req);
      if (depth === null) throw new DavError(400);
      // A missing Depth means infinity, which a tree this size does not enumerate in one go.
      if (depth !== "0" && depth !== "1") throw new DavError(403, "propfind-finite-depth");
      const request = parsePropfind(await readBody(req));
      const segments = existingPath({ path });
      const row = resolve(db, user.id, getOrCreateRoot(db, user.id, now()), segments);
      if (!row) throw new DavError(404);
      const resources = [toResource(getNode(db, row.id), segments)];
      if (depth === "1" && row.kind === "folder") {
        for (const child of listChildren(db, user.id, row.id)) {
          resources.push(toResource(child, [...segments, child.name]));
        }
      }
      const context: PropContext = {
        quotaBytes: user.quotaBytes,
        usedBytes: usedBytes(db, user.id),
        locksOf: (at) => locks.discover(user.id, at),
      };
      xml(res, 207, multistatus(resources.map((r) => propfindEntry(r, request, context))));
    },

    async PROPPATCH({ req, res, user, path }) {
      const props = parsePropertyUpdate(await readBody(req));
      const segments = existingPath({ path });
      const row = resolve(db, user.id, getOrCreateRoot(db, user.id, now()), segments);
      if (!row) throw new DavError(404);
      locks.assertWritable(user.id, segments, submittedTokens(req));
      const resource = toResource(getNode(db, row.id), segments);
      xml(res, 207, multistatus([proppatchEntry(resource, props)]));
    },

    GET(call) {
      serve(call);
    },
    HEAD(call) {
      serve(call);
    },

    async PUT(call) {
      const { req, res, user, ip } = call;
      if (req.headers["content-range"] !== undefined) throw new DavError(400);
      const segments = newPath(call);
      const header = req.headers["content-length"];
      const declaredLength = header === undefined ? undefined : Number(header);
      if (declaredLength !== undefined && !Number.isSafeInteger(declaredLength)) {
        throw new DavError(400);
      }
      const submitted = submittedTokens(req);
      const { created, versionId } = await storeFile(
        { db, config, now, user, ip, ledger },
        segments,
        { kind: "request", req, declaredLength },
        (existing) => {
          checkConditions(req, existing);
          locks.assertWritable(user.id, segments, submitted, {
            membership: existing === undefined,
          });
        },
      );
      empty(res, created ? 201 : 204, { ETag: `"${versionId}"` });
    },

    MKCOL(call) {
      const { req, res, user } = call;
      if (hasBody(req)) throw new DavError(415);
      const segments = newPath(call);
      const name = segments.at(-1);
      if (name === undefined) throw new DavError(405);
      locks.assertWritable(user.id, segments, submittedTokens(req), { membership: true });
      db.transaction((tx) => {
        const parent = resolveParent(tx, user.id, getOrCreateRoot(tx, user.id, now()), segments);
        if (!parent) throw new DavError(409);
        if (childOf(tx, user.id, parent.id, name)) throw new DavError(405);
        createFolder(tx, user.id, parent.id, name, now());
      });
      empty(res, 201);
    },

    DELETE(call) {
      const { req, res, user, ip } = call;
      const depth = depthOf(req);
      if (depth !== undefined && depth !== "infinity") throw new DavError(400);
      const segments = existingPath(call);
      if (segments.length === 0) throw new DavError(403);
      locks.assertWritable(user.id, segments, submittedTokens(req), {
        membership: true,
        subtree: true,
      });
      db.transaction((tx) => {
        const row = resolve(tx, user.id, getOrCreateRoot(tx, user.id, now()), segments);
        if (!row) throw new DavError(404);
        trashItem(tx, user.id, row, { at: now(), ip, via: "webdav" });
      });
      locks.removeUnder(user.id, segments);
      empty(res, 204);
    },

    MOVE(call) {
      const { req, res, user, ip } = call;
      const { src, dst, overwrite } = transferTargets(call);
      const submitted = submittedTokens(req);
      locks.assertWritable(user.id, src, submitted, { membership: true, subtree: true });
      locks.assertWritable(user.id, dst, submitted, { membership: true, subtree: true });
      const name = dst.at(-1);
      const replaced = db.transaction((tx) => {
        const root = getOrCreateRoot(tx, user.id, now());
        const item = resolve(tx, user.id, root, src);
        if (!item) throw new DavError(404);
        const parent = resolveParent(tx, user.id, root, dst);
        if (!parent || name === undefined) throw new DavError(409);
        const existing = childOf(tx, user.id, parent.id, name);
        if (existing && !overwrite) throw new DavError(412);
        const at = now();
        if (existing) trashItem(tx, user.id, existing, { at, ip, via: "webdav" });
        relocateItem(tx, user.id, item, { parentId: parent.id, name }, at);
        return existing !== undefined;
      });
      locks.removeUnder(user.id, src);
      if (replaced) locks.removeUnder(user.id, dst);
      empty(res, replaced ? 204 : 201);
    },

    async COPY(call) {
      const { req, res, user, ip } = call;
      const { src, dst, overwrite } = transferTargets(call);
      const depth = depthOf(req);
      if (depth === null || depth === "1") throw new DavError(400);
      locks.assertWritable(user.id, dst, submittedTokens(req), { membership: true, subtree: true });
      const replaced = await copyTree({
        db,
        config,
        now,
        ledger,
        user,
        ip,
        src,
        dst,
        overwrite,
        shallow: depth === "0",
      });
      if (replaced) locks.removeUnder(user.id, dst);
      empty(res, replaced ? 204 : 201);
    },

    async LOCK(call) {
      const { req, res, user, ip } = call;
      const info = parseLockInfo(await readBody(req));
      const segments = newPath(call);
      const submitted = submittedTokens(req);
      const timeout = lockTimeoutSeconds(req);

      if (!info) {
        // A refresh: the body is empty and the If header names the lock.
        const lock = [...submitted]
          .map((token) => locks.find(user.id, segments, token))
          .find((found) => found !== undefined);
        if (!lock) throw new DavError(412);
        locks.refresh(lock, timeout);
        lockResponse(res, 200, lock, false);
        return;
      }

      const depth = depthOf(req);
      if (depth === null || depth === "1") throw new DavError(400);
      const row = resolve(db, user.id, getOrCreateRoot(db, user.id, now()), segments);
      locks.assertLockable(user.id, segments, depth ?? "infinity");
      if (!row) {
        // Locking an unmapped URL creates an empty file to hold the lock (RFC 4918 section 7.3).
        locks.assertWritable(user.id, segments, submitted, { membership: true });
        await storeFile(
          { db, config, now, user, ip, ledger },
          segments,
          { kind: "empty" },
          (existing) => {
            // Nothing was there a moment ago; never turn a race into an overwrite.
            if (existing) throw new DavError(409);
          },
        );
      }
      const lock = locks.create({
        userId: user.id,
        path: segments,
        depth: row?.kind === "folder" ? (depth ?? "infinity") : "0",
        ownerXml: info.ownerXml,
        timeoutSeconds: timeout,
      });
      lockResponse(res, row ? 200 : 201, lock, true);
    },

    UNLOCK(call) {
      const { req, res, user } = call;
      const token = lockTokenHeader(req);
      if (token === undefined) throw new DavError(400);
      const lock = locks.find(user.id, existingPath(call), token);
      if (!lock) throw new DavError(409, "lock-token-matches-request-uri");
      locks.remove(lock);
      empty(res, 204);
    },
  };

  function serve({ req, res, user, path }: Call): void {
    const segments = existingPath({ path });
    const row = resolve(db, user.id, getOrCreateRoot(db, user.id, now()), segments);
    if (!row) throw new DavError(404);
    if (row.kind === "folder") throw new DavError(405, undefined, [], { Allow: ALLOW });
    if (!row.currentVersionId) throw new DavError(404);
    const version = findVersion(db, user.id, row.id, row.currentVersionId);
    // The entity tag and modification time PROPFIND reports, instead of the blob file's.
    res.setHeader("ETag", `"${version.id}"`);
    res.setHeader("Last-Modified", row.updatedAt.toUTCString());
    sendBlob(config.dataDir, req, res, row, version);
  }

  function lockResponse(
    res: Response,
    status: number,
    lock: Parameters<typeof activeLockXml>[0],
    announce: boolean,
  ): void {
    if (announce) res.setHeader("Lock-Token", `<${lock.token}>`);
    xml(
      res,
      status,
      `${XML_DECLARATION}<D:prop xmlns:D="DAV:"><D:lockdiscovery>${activeLockXml(lock)}</D:lockdiscovery></D:prop>`,
    );
  }

  /** Source, destination and Overwrite of a COPY or MOVE, with the checks both share. */
  function transferTargets(call: Call): { src: string[]; dst: string[]; overwrite: boolean } {
    const { req } = call;
    const src = existingPath(call);
    const header = req.get("destination");
    if (header === undefined) throw new DavError(400);
    const hosts = [ownHost, req.get("host")?.toLowerCase()].filter((h) => h !== undefined);
    const target = destinationSegments(header, hosts);
    if (!target.local) throw new DavError(502);
    if (!target.segments) throw new DavError(400);
    const dst = target.segments;
    const overwrite = overwriteAllowed(req);
    // Onto itself, or into / over its own ancestor, is never meaningful.
    if (src.length === 0 || dst.length === 0 || isSamePath(src, dst)) throw new DavError(403);
    if (isBelow(dst, src) || isBelow(src, dst)) throw new DavError(403);
    return { src, dst, overwrite };
  }

  router.use(async (req, res) => {
    res.setHeader("DAV", "1, 2");
    res.setHeader("MS-Author-Via", "DAV");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    const user = authenticate(req);
    const handler = Object.hasOwn(handlers, req.method)
      ? handlers[req.method as (typeof METHODS)[number]]
      : undefined;
    if (!handler) throw new DavError(405, undefined, [], { Allow: ALLOW });
    await handler({ req, res, user, ip: req.ip, path: parseSegments(mountedPath(req)) });
  });
  router.use(davErrorHandler);

  return {
    router,
    cleanup: () => sweepDavTemp(config.dataDir, DAY_MS, now()),
  };
}
