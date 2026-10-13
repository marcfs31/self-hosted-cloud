import { mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { FileStore } from "@tus/file-store";
import { Server, Upload } from "@tus/server";
import type { RequestHandler, Response as ExpressResponse } from "express";
import { z } from "zod";
import { errorResponse, fileName, type ErrorCode, type User } from "@cloud/shared";
import { authOf } from "../auth/sessions.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { HttpError } from "../http/errors.js";
import { commitFileVersion } from "./commit.js";
import { createInFlightLedger, type InFlightLedger } from "./in-flight.js";
import { commitBlob, isUuid, removeBlob, uploadTempPath, uploadsDir } from "./storage.js";
import { requireActive, usedBytes } from "./tree.js";

export const UPLOAD_PATH = "/api/uploads";
const UPLOAD_EXPIRY_MS = 24 * 60 * 60 * 1000;
/**
 * A drop-box visitor is anonymous: what they have announced but not yet sent may hold at most
 * this many bytes per share (so also the largest file a drop box takes), and counts only while
 * it makes progress. Without this, one bodiless POST reserved the owner's whole quota for 24 h.
 */
export const DROP_BOX_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;
const TUS_METHODS = new Set(["OPTIONS", "POST", "HEAD", "PATCH", "DELETE"]);

/**
 * After onUploadFinish the temp file has been renamed into place, but a creation request that
 * finishes the upload in the same breath re-reads it once more (for Upload-Expires). Serve that one
 * read from memory; the entry is dropped when tus emits POST_FINISH.
 */
class CommittingStore extends FileStore {
  readonly committed = new Map<string, Upload>();

  override getUpload(id: string): Promise<Upload> {
    const done = this.committed.get(id);
    return done ? Promise.resolve(done) : super.getUpload(id);
  }
}

/** A hook failure in the shape @tus/server understands: status_code plus a ready-made body. */
class TusFailure extends Error {
  readonly body: string;
  constructor(
    readonly status_code: number,
    code: ErrorCode,
  ) {
    super(code);
    this.name = "TusFailure";
    this.body = JSON.stringify({ error: { code } });
  }
}

function asTusFailure(err: unknown): unknown {
  return err instanceof HttpError ? new TusFailure(err.status, err.code) : err;
}

const uploadMetadata = z.object({
  filename: fileName,
  parentId: z.string().min(1),
  replaceId: z.string().min(1).optional(),
});

/** What a drop-box client may say about its upload: the target folder and replaceId are not its call. */
const dropBoxMetadata = z.object({ filename: fileName });

function codeForStatus(status: number): ErrorCode {
  if (status === 404 || status === 410) return "not_found";
  if (status >= 500 && status !== 501) return "internal";
  return "invalid_request";
}

/** Every error body is {error:{code}}: keep ours, replace tus' plain-text ones by status. */
function errorBodyFor(status: number, text: string): ErrorCode {
  try {
    const parsed = errorResponse.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data.error.code;
  } catch {
    // not JSON: one of tus' own text bodies
  }
  return codeForStatus(status);
}

/** Who a tus request acts for, decided by the caller before the request reaches tus. */
export interface UploadActor {
  /** Whose files, quota and in-flight bytes the upload belongs to. */
  owner: User;
  /** The endpoint the client talked to; the Location header of a new upload is built from it. */
  path: string;
  /** Set for drop-box uploads: they land in `folderId` and can only be continued via this share. */
  share?: { id: string; folderId: string };
  /** Client address for the owner's activity log; never set for drop boxes (a visitor's IP is not the owner's data). */
  ip?: string | undefined;
}

export interface UploadService {
  /** Express handler for every tus request at UPLOAD_PATH; mount it behind the session middleware. */
  handler: RequestHandler;
  /** Serve one tus request for an actor the caller has already authorised (shares). */
  serve: (
    actor: UploadActor,
    req: Parameters<RequestHandler>[0],
    res: ExpressResponse,
  ) => Promise<void>;
  /** Drop expired unfinished uploads and re-sync the in-flight quota accounting. */
  cleanup: () => Promise<void>;
}

export function createUploadService(opts: {
  db: Db;
  config: Config;
  now: () => number;
  ledger?: InFlightLedger;
}): UploadService {
  const { db, config, now } = opts;
  const ledger = opts.ledger ?? createInFlightLedger(now);
  const actors = new WeakMap<Request, UploadActor>();
  const inFlight = ledger.uploads;
  let started: Promise<{ server: Server; store: CommittingStore }> | undefined;

  function actorOf(req: Request): UploadActor {
    const actor = actors.get(req);
    if (!actor) throw new TusFailure(401, "unauthenticated");
    return actor;
  }

  /** Validate a new upload and reserve its bytes; throws a TusFailure to refuse it. */
  function begin(req: Request, upload: Upload): { metadata: Record<string, string> } {
    const { owner: user, share } = actorOf(req);
    const sent = upload.metadata ?? {};
    let creation: z.infer<typeof uploadMetadata>;
    if (share) {
      // A drop box never overwrites, and the folder is not the client's call: it is the share's.
      const parsed = dropBoxMetadata.safeParse(sent);
      if (!parsed.success || Object.hasOwn(sent, "replaceId")) {
        throw new TusFailure(400, "invalid_request");
      }
      creation = { filename: parsed.data.filename, parentId: share.folderId };
    } else {
      const parsed = uploadMetadata.safeParse(sent);
      if (!parsed.success) throw new TusFailure(400, "invalid_request");
      creation = parsed.data;
    }
    if (upload.size === undefined) throw new TusFailure(400, "invalid_request");
    const { filename, parentId, replaceId } = creation;
    try {
      requireActive(db, user.id, parentId, "folder");
      if (replaceId !== undefined) {
        const target = requireActive(db, user.id, replaceId, "file");
        if (target.parentId !== parentId) throw new HttpError(404, "not_found");
      }
    } catch (err) {
      throw asTusFailure(err);
    }
    if (share && ledger.dropBoxBytes(user.id, share.id) + upload.size > DROP_BOX_BUDGET_BYTES) {
      throw new TusFailure(413, "quota_exceeded");
    }
    // A drop box must fit beside everything the owner has announced; the owner's own upload
    // only has to fit beside their own, so a stranger's idle reservation never locks them out.
    const reserved = ledger.ownBytes(user.id) + (share ? ledger.dropBoxBytes(user.id) : 0);
    if (usedBytes(db, user.id) + reserved + upload.size > user.quotaBytes) {
      throw new TusFailure(413, "quota_exceeded");
    }
    // Checked and reserved in the same tick, so concurrent creations cannot both fit.
    inFlight.set(upload.id, {
      ownerId: user.id,
      size: upload.size,
      touchedAt: now(),
      ...(share && { shareId: share.id }),
    });
    return {
      // ownerId is always the session user; anything the client sent is discarded.
      metadata: {
        filename,
        parentId,
        ...(replaceId !== undefined && { replaceId }),
        ownerId: user.id,
        ...(share && { shareId: share.id }),
      },
    };
  }

  async function reconcile(store: CommittingStore): Promise<void> {
    const ids = new Set((await store.configstore.list?.()) ?? []);
    for (const id of inFlight.keys()) if (!ids.has(id)) inFlight.delete(id);
    for (const id of ids) {
      if (inFlight.has(id)) continue;
      const info = await store.configstore.get(id);
      const ownerId = info?.metadata?.ownerId;
      if (info?.size !== undefined && typeof ownerId === "string") {
        const shareId = info.metadata?.shareId;
        inFlight.set(id, {
          ownerId,
          size: info.size,
          touchedAt: now(),
          ...(typeof shareId === "string" && { shareId }),
        });
      }
    }
  }

  function start(): Promise<{ server: Server; store: CommittingStore }> {
    started ??= (async () => {
      const directory = uploadsDir(config.dataDir);
      await mkdir(directory, { recursive: true });
      const store = new CommittingStore({
        directory,
        expirationPeriodInMilliseconds: UPLOAD_EXPIRY_MS,
      });
      // Uploads must declare their length up front: quota is checked against it.
      store.extensions = store.extensions.filter((e) => e !== "creation-defer-length");

      const server = new Server({
        // Only a placeholder: the endpoint differs per actor, see generateUrl and getFileIdFromRequest.
        path: UPLOAD_PATH,
        datastore: store,
        generateUrl: (req, { id }) => `${actorOf(req).path}/${id}`,
        getFileIdFromRequest: (_req, lastPath) =>
          lastPath !== undefined && isUuid(lastPath) ? lastPath : undefined,
        allowedOrigins: [config.publicOrigin],
        exposedHeaders: ["Cloud-File-Id"],
        namingFunction: () => crypto.randomUUID(),

        onIncomingRequest: async (req, uploadId) => {
          const { owner, share } = actorOf(req);
          if (req.method === "POST") return; // the ID of a new upload does not exist yet
          const notFound = new TusFailure(404, "not_found");
          if (!isUuid(uploadId)) throw notFound;
          const upload = await store.getUpload(uploadId).catch(() => undefined);
          // A foreign upload looks exactly like a missing one: no existence oracle. A drop-box
          // upload belongs to its share alone, and a session upload to no share.
          const shareId = upload?.metadata?.shareId ?? undefined;
          if (upload?.metadata?.ownerId !== owner.id || shareId !== share?.id) throw notFound;
          const reserved = inFlight.get(uploadId);
          if (req.method === "PATCH" && reserved) reserved.touchedAt = now();
        },

        onUploadCreate: (req, upload) => Promise.resolve(begin(req, upload)),

        onUploadFinish: async (req, upload) => {
          try {
            const fileId = await finish(store, upload, actorOf(req).ip);
            return { headers: { "Cloud-File-Id": fileId } };
          } catch (err) {
            throw asTusFailure(err);
          }
        },

        onResponseError: (_req, err) => {
          if (err instanceof Error && !(err instanceof TusFailure)) {
            console.error("upload error:", err.stack ?? err.name);
          }
          return undefined;
        },
      });
      server.on("POST_TERMINATE", (_req: unknown, _res: unknown, id: string) => {
        inFlight.delete(id);
      });
      server.on("POST_FINISH", (_req: unknown, _res: unknown, upload: Upload) => {
        store.committed.delete(upload.id);
      });
      await reconcile(store);
      return { server, store };
    })().catch((err: unknown) => {
      started = undefined;
      throw err;
    });
    return started;
  }

  async function finish(
    store: CommittingStore,
    upload: Upload,
    ip: string | undefined,
  ): Promise<string> {
    const ownerId = upload.metadata?.ownerId;
    const parsed = uploadMetadata.safeParse(upload.metadata ?? {});
    if (typeof ownerId !== "string" || !isUuid(ownerId) || !parsed.success) {
      throw new TusFailure(400, "invalid_request");
    }
    const { filename, parentId, replaceId } = parsed.data;
    // Defence in depth: begin() never lets a drop-box upload carry a replaceId.
    if (upload.metadata?.shareId !== undefined && replaceId !== undefined) {
      throw new TusFailure(400, "invalid_request");
    }
    const versionId = crypto.randomUUID();
    const blob = await commitBlob(
      config.dataDir,
      ownerId,
      versionId,
      uploadTempPath(config.dataDir, upload.id),
    );
    try {
      const fileId = db.transaction((tx) =>
        commitFileVersion(tx, {
          ownerId,
          parentId,
          filename,
          replaceId,
          versionId,
          blob,
          at: now(),
          ip,
          via: upload.metadata?.shareId !== undefined ? "drop box" : undefined,
        }),
      );
      store.committed.set(
        upload.id,
        new Upload({
          id: upload.id,
          size: blob.size,
          offset: blob.size,
          ...(upload.metadata && { metadata: upload.metadata }),
          ...(upload.creation_date && { creation_date: upload.creation_date }),
        }),
      );
      return fileId;
    } catch (err) {
      await removeBlob(config.dataDir, ownerId, versionId);
      throw err;
    } finally {
      // The temp file already moved into place (or was removed): only its metadata is left.
      await store.configstore.delete(upload.id).catch(() => undefined);
      inFlight.delete(upload.id);
    }
  }

  function toWebRequest(req: Parameters<RequestHandler>[0]): Request {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) for (const v of value) headers.append(name, v);
      else if (value !== undefined) headers.set(name, value);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    return new Request(new URL(req.originalUrl, "http://localhost"), {
      method: req.method,
      headers,
      ...(hasBody && { body: Readable.toWeb(req), duplex: "half" }),
    });
  }

  async function send(res: ExpressResponse, response: globalThis.Response): Promise<void> {
    res.status(response.status);
    const failed = response.status >= 400;
    for (const [name, value] of response.headers) {
      const lower = name.toLowerCase();
      if (lower === "content-length" || (failed && lower === "content-type")) continue;
      res.setHeader(name, value);
    }
    if (failed) {
      const code = errorBodyFor(response.status, await response.text());
      res.type("application/json").send(JSON.stringify({ error: { code } }));
    } else {
      res.end(Buffer.from(await response.arrayBuffer()));
    }
  }

  async function serve(
    actor: UploadActor,
    req: Parameters<RequestHandler>[0],
    res: ExpressResponse,
  ): Promise<void> {
    if (!TUS_METHODS.has(req.method)) throw new HttpError(404, "not_found");
    const { server } = await start();
    const webRequest = toWebRequest(req);
    actors.set(webRequest, actor);
    await send(res, await server.handleWeb(webRequest));
  }

  const handler: RequestHandler = (req, res, next) => {
    serve({ owner: authOf(res).user, path: UPLOAD_PATH, ip: req.ip }, req, res).catch(next);
  };

  async function cleanup(): Promise<void> {
    const { server, store } = await start();
    await server.cleanUpExpiredUploads();
    await reconcile(store);
  }

  return { handler, serve, cleanup };
}
