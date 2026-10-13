import { mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { FileStore } from "@tus/file-store";
import { Server, Upload } from "@tus/server";
import { eq } from "drizzle-orm";
import type { RequestHandler, Response as ExpressResponse } from "express";
import { z } from "zod";
import { errorResponse, fileName, uniqueName, type ErrorCode, type User } from "@cloud/shared";
import { authOf } from "../auth/sessions.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { fileVersions, files, users } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";
import { mimeForName } from "./mime.js";
import { commitBlob, isUuid, removeBlob, uploadTempPath, uploadsDir } from "./storage.js";
import { activeSiblingNames, requireActive, usedBytes } from "./tree.js";

export const UPLOAD_PATH = "/api/uploads";
const UPLOAD_EXPIRY_MS = 24 * 60 * 60 * 1000;
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

interface InFlight {
  ownerId: string;
  size: number;
}

/** Who a tus request acts for, decided by the caller before the request reaches tus. */
export interface UploadActor {
  /** Whose files, quota and in-flight bytes the upload belongs to. */
  owner: User;
  /** The endpoint the client talked to; the Location header of a new upload is built from it. */
  path: string;
  /** Set for drop-box uploads: they land in `folderId` and can only be continued via this share. */
  share?: { id: string; folderId: string };
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
}): UploadService {
  const { db, config, now } = opts;
  const actors = new WeakMap<Request, UploadActor>();
  const inFlight = new Map<string, InFlight>();
  let started: Promise<{ server: Server; store: CommittingStore }> | undefined;

  function actorOf(req: Request): UploadActor {
    const actor = actors.get(req);
    if (!actor) throw new TusFailure(401, "unauthenticated");
    return actor;
  }

  function inFlightBytes(ownerId: string): number {
    let total = 0;
    for (const entry of inFlight.values()) if (entry.ownerId === ownerId) total += entry.size;
    return total;
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
    if (usedBytes(db, user.id) + inFlightBytes(user.id) + upload.size > user.quotaBytes) {
      throw new TusFailure(413, "quota_exceeded");
    }
    // Checked and reserved in the same tick, so concurrent creations cannot both fit.
    inFlight.set(upload.id, { ownerId: user.id, size: upload.size });
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
        inFlight.set(id, { ownerId, size: info.size });
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
        },

        onUploadCreate: (req, upload) => Promise.resolve(begin(req, upload)),

        onUploadFinish: async (_req, upload) => {
          try {
            const fileId = await finish(store, upload);
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

  async function finish(store: CommittingStore, upload: Upload): Promise<string> {
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
      const fileId = db.transaction((tx) => {
        const owner = tx.select().from(users).where(eq(users.id, ownerId)).get();
        if (!owner) throw new HttpError(404, "not_found");
        requireActive(tx, ownerId, parentId, "folder");
        const replaced =
          replaceId === undefined ? undefined : requireActive(tx, ownerId, replaceId, "file");
        if (replaced && replaced.parentId !== parentId) throw new HttpError(404, "not_found");
        // Authoritative quota check: in-flight reservations were only an early warning.
        if (usedBytes(tx, ownerId) + blob.size > owner.quotaBytes) {
          throw new HttpError(413, "quota_exceeded");
        }
        const at = new Date(now());
        const fileId = replaced?.id ?? crypto.randomUUID();
        const name = replaced?.name ?? uniqueName(filename, activeSiblingNames(tx, parentId));
        if (replaced) {
          tx.insert(fileVersions)
            .values({
              id: versionId,
              fileId,
              ownerId,
              mime: mimeForName(name),
              createdAt: at,
              ...blob,
            })
            .run();
          tx.update(files)
            .set({ currentVersionId: versionId, updatedAt: at })
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
              createdAt: at,
              updatedAt: at,
            })
            .run();
          tx.insert(fileVersions)
            .values({
              id: versionId,
              fileId,
              ownerId,
              mime: mimeForName(name),
              createdAt: at,
              ...blob,
            })
            .run();
        }
        return fileId;
      });
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
    serve({ owner: authOf(res).user, path: UPLOAD_PATH }, req, res).catch(next);
  };

  async function cleanup(): Promise<void> {
    const { server, store } = await start();
    await server.cleanUpExpiredUploads();
    await reconcile(store);
  }

  return { handler, serve, cleanup };
}
