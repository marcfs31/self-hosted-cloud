import { open, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createHash } from "node:crypto";
import {
  changesPage,
  errorResponse,
  fileNode,
  folderListing,
  meResponse,
  versionListing,
  type ChangesPage,
  type ErrorCode,
  type FileNode,
  type FileVersion,
  type User,
} from "@cloud/shared";
import { ApiError, BadResponseError, NetworkError } from "./errors.js";
import { tusUpload } from "./tus.js";

export { ApiError, BadResponseError, NetworkError } from "./errors.js";

export interface Parser<T> {
  parse(input: unknown): T;
}

export interface UploadRequest {
  /** Absolute path of the local file. */
  path: string;
  size: number;
  name: string;
  parentId: string;
  /** Upload as a new version of this file (it must live in `parentId`). */
  replaceId?: string;
}

export interface DownloadResult {
  size: number;
  sha256: string;
}

/** What the sync engine needs from the server; ApiClient is the only implementation that calls fetch. */
export interface SyncApi {
  /** The user's root folder (created on first use). */
  root(): Promise<FileNode>;
  changes(cursor: string | undefined): Promise<ChangesPage>;
  listFolder(id: string): Promise<FileNode[]>;
  createFolder(parentId: string, name: string): Promise<FileNode>;
  rename(id: string, patch: { name?: string; parentId?: string }): Promise<FileNode>;
  trash(id: string): Promise<void>;
  versions(id: string): Promise<FileVersion[]>;
  /** Resolves with the file's ID (the existing one when `replaceId` is set). */
  upload(request: UploadRequest): Promise<string>;
  /** Streams one version to `tempPath` (created exclusively, fsynced); the caller renames it into place. */
  download(id: string, versionId: string, tempPath: string): Promise<DownloadResult>;
}

const REQUEST_TIMEOUT_MS = 30_000;

function describeFailure(cause: unknown): string {
  if (!(cause instanceof Error)) return "unknown error";
  const inner = cause.cause;
  if (inner instanceof Error) {
    return inner.message || (inner as NodeJS.ErrnoException).code || cause.message;
  }
  return cause.message;
}

export async function apiErrorOf(res: Response): Promise<ApiError> {
  let code: ErrorCode | undefined;
  try {
    const parsed = errorResponse.safeParse(JSON.parse(await res.text()));
    if (parsed.success) code = parsed.data.error.code;
  } catch {
    // not a JSON error body: the HTTP status is all there is
  }
  return new ApiError(res.status, code);
}

const folderChildren: Parser<FileNode[]> = {
  parse: (input) => folderListing.parse(input).children,
};
const versions: Parser<FileVersion[]> = { parse: (input) => versionListing.parse(input).versions };
const account: Parser<User> = { parse: (input) => meResponse.parse(input).user };
const rootFolder: Parser<FileNode> = { parse: (input) => folderListing.parse(input).folder };

/** The only place that calls fetch. Every request carries the app password as a Bearer token. */
export class ApiClient implements SyncApi {
  constructor(
    /** Origin of the server, e.g. https://cloud.example.com */
    readonly server: string,
    private readonly token: string,
    private readonly chunkSize = 8 * 1024 * 1024,
  ) {}

  get authorization(): string {
    return `Bearer ${this.token}`;
  }

  url(path: string): string {
    return new URL(path, this.server).toString();
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    timeout: boolean,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: this.authorization,
      Accept: "application/json",
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    if (timeout) init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(this.url(path), init);
    } catch (cause) {
      throw new NetworkError(`Could not reach ${this.server}: ${describeFailure(cause)}`);
    }
    if (!res.ok) throw await apiErrorOf(res);
    return res;
  }

  private async json<T>(
    method: string,
    path: string,
    parser: Parser<T>,
    body?: unknown,
  ): Promise<T> {
    const res = await this.send(method, path, body, true);
    try {
      return parser.parse(await res.json());
    } catch {
      throw new BadResponseError();
    }
  }

  private async noContent(method: string, path: string): Promise<void> {
    const res = await this.send(method, path, undefined, true);
    await res.body?.cancel();
  }

  /** The account the app password belongs to (used to test a connection). */
  me(): Promise<User> {
    return this.json("GET", "/api/auth/me", account);
  }

  root(): Promise<FileNode> {
    return this.json("GET", "/api/files/root", rootFolder);
  }

  changes(cursor: string | undefined): Promise<ChangesPage> {
    const query = new URLSearchParams({ limit: "500" });
    if (cursor !== undefined) query.set("cursor", cursor);
    return this.json("GET", `/api/changes?${query.toString()}`, changesPage);
  }

  listFolder(id: string): Promise<FileNode[]> {
    return this.json("GET", `/api/folders/${encodeURIComponent(id)}`, folderChildren);
  }

  createFolder(parentId: string, name: string): Promise<FileNode> {
    return this.json("POST", "/api/folders", fileNode, { parentId, name });
  }

  rename(id: string, patch: { name?: string; parentId?: string }): Promise<FileNode> {
    return this.json("PATCH", `/api/files/${encodeURIComponent(id)}`, fileNode, patch);
  }

  trash(id: string): Promise<void> {
    return this.noContent("DELETE", `/api/files/${encodeURIComponent(id)}`);
  }

  versions(id: string): Promise<FileVersion[]> {
    return this.json("GET", `/api/files/${encodeURIComponent(id)}/versions`, versions);
  }

  upload(request: UploadRequest): Promise<string> {
    return tusUpload(
      { endpoint: this.url("/api/uploads"), authorization: this.authorization },
      {
        path: request.path,
        size: request.size,
        metadata: {
          filename: request.name,
          parentId: request.parentId,
          ...(request.replaceId !== undefined && { replaceId: request.replaceId }),
        },
      },
      this.chunkSize,
    );
  }

  async download(id: string, versionId: string, tempPath: string): Promise<DownloadResult> {
    const res = await this.send(
      "GET",
      `/api/files/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/content`,
      undefined,
      false,
    );
    if (res.body === null) throw new BadResponseError();
    const hash = createHash("sha256");
    let size = 0;
    const handle = await open(tempPath, "wx");
    try {
      for await (const part of Readable.fromWeb(res.body as WebReadableStream<Uint8Array>)) {
        const chunk = part as Uint8Array;
        hash.update(chunk);
        size += chunk.byteLength;
        await handle.write(chunk);
      }
      await handle.sync();
    } catch (err) {
      await handle.close();
      await rm(tempPath, { force: true });
      throw err;
    }
    await handle.close();
    return { size, sha256: hash.digest("hex") };
  }
}
