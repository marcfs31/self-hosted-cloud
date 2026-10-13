import { and, eq } from "drizzle-orm";
import type { Response } from "express";
import { INLINE_MIME_TYPES } from "@cloud/shared";
import { fileVersions } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";
import { blobPath } from "./storage.js";
import type { FileRow, Tx, VersionRow } from "./tree.js";

const CONTENT_CSP =
  "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";
const INLINE = new Set<string>(INLINE_MIME_TYPES);

export function findVersion(
  tx: Tx,
  ownerId: string,
  fileId: string,
  versionId: string,
): VersionRow {
  const row = tx
    .select()
    .from(fileVersions)
    .where(
      and(
        eq(fileVersions.id, versionId),
        eq(fileVersions.fileId, fileId),
        eq(fileVersions.ownerId, ownerId),
      ),
    )
    .get();
  if (!row) throw new HttpError(404, "not_found");
  return row;
}

/** The one place a stored version's bytes are served: private routes and public share routes. */
export function sendBlob(
  dataDir: string,
  req: { query: Record<string, unknown> },
  res: Response,
  file: FileRow,
  version: VersionRow,
): void {
  const inline = INLINE.has(version.mime) && req.query.download !== "1";
  // res.attachment builds a safe RFC 6266 / RFC 5987 header from the name; inline reuses it.
  res.attachment(file.name);
  if (inline) {
    res.setHeader(
      "Content-Disposition",
      String(res.getHeader("Content-Disposition")).replace(/^attachment/, "inline"),
    );
    res.setHeader(
      "Content-Type",
      version.mime === "text/plain" ? "text/plain; charset=utf-8" : version.mime,
    );
  } else {
    res.setHeader("Content-Type", "application/octet-stream");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", CONTENT_CSP);
  res.setHeader("Cache-Control", "private, no-cache");
  res.sendFile(
    blobPath(dataDir, version.ownerId, version.id),
    { dotfiles: "allow", cacheControl: false },
    (err) => {
      if (!err || res.headersSent) return;
      const e = err as { status?: number; code?: string; headers?: Record<string, string> };
      if (e.status === 416) {
        res
          .set(e.headers ?? {})
          .status(416)
          .end();
        return;
      }
      if (e.code === "ENOENT" || e.status === 404) {
        console.error("blob missing for version", version.id);
        res.status(404).json({ error: { code: "not_found" } });
        return;
      }
      console.error("sendFile failed:", e.code ?? e.status ?? "unknown");
      res.status(500).json({ error: { code: "internal" } });
    },
  );
}
