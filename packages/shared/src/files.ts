import { z } from "zod";

/*
 * Files contract (all under /api, all require a session, all scoped to the session user).
 * Clients address files and folders by ID only; a missing or foreign ID is 404 not_found.
 *
 *   GET    /files/root                 → FolderListing  (creates the user's root folder on first use)
 *   GET    /folders/:id                → FolderListing  (folder must not be trashed)
 *   POST   /folders                    CreateFolderRequest → FileNode (201); taken name → 409 name_conflict
 *   PATCH  /files/:id                  UpdateFileRequest → FileNode (rename and/or move)
 *                                        taken name → 409 name_conflict; into itself/descendant or
 *                                        touching the root → 409 invalid_move
 *   DELETE /files/:id                  → 204 (moves the item and its subtree to the trash)
 *   GET    /files/:id/content          → bytes with Range/ETag support. `?download=1` forces
 *                                        attachment. Served inline only for INLINE_MIME_TYPES,
 *                                        otherwise as an attachment of application/octet-stream.
 *                                        Always sends X-Content-Type-Options: nosniff and
 *                                        Content-Security-Policy: sandbox; default-src 'none';
 *                                        img-src 'self'; media-src 'self'; style-src 'unsafe-inline'.
 *   GET    /usage                      → UsageResponse
 *   POST   /files/exists               ExistsRequest → ExistsResponse: which of the given SHA-256
 *                                        hashes already exist as any version of an active file
 *                                        of the user (used by phone photo backup to skip duplicates)
 *
 * Version history (files only; every upload or replace adds a version):
 *   GET    /files/:id/versions                      → VersionListing (newest first)
 *   GET    /files/:id/versions/:versionId/content   → that version's bytes (same headers as content)
 *   POST   /files/:id/versions/:versionId/restore   → FileNode; makes that version current
 *                                                    (no copy; newer versions stay listed)
 *   DELETE /files/:id/versions/:versionId           → 204; the current version → 409 version_is_current
 *
 *   GET    /trash                      → TrashListing (top-level trashed items, most recently trashed first)
 *   POST   /trash/:id/restore          → FileNode; restores into the original parent, or the root
 *                                        if that parent is gone or trashed; a taken name gets
 *                                        "name (1).ext" (see uniqueName).
 *   DELETE /trash/:id                  → 204 permanent delete of the item and its subtree (rows + blobs)
 *   DELETE /trash                      → 204 empty the trash
 *   Trashed items older than TRASH_RETENTION_DAYS are purged automatically.
 *
 * Uploads use the tus 1.0.0 protocol at /api/uploads (creation + termination extensions).
 *   Upload-Metadata (base64 values): `filename` (required, a valid FileName) and `parentId`
 *   (required, an active folder ID), optional `replaceId` (an active file of the user in that
 *   folder): the upload becomes the new current version of that file and keeps its name.
 *   Upload-Length is required (no deferred length).
 *   Creation is refused with 413 quota_exceeded when used + in-flight + Upload-Length > quota.
 *   On completion the file is committed into the folder; a taken name gets "name (1).ext".
 *   The finished response carries the header `Cloud-File-Id: <new file id>`.
 *   Error bodies are JSON {error:{code}} like every other endpoint.
 */

export const TRASH_RETENTION_DAYS = 30;

/** MIME types that are safe to render inline in the browser; everything else downloads. */
export const INLINE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "application/pdf",
  "text/plain",
] as const;

/** Path separators, C0 control characters and DEL. */
function hasForbiddenChar(name: string): boolean {
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (ch === "/" || ch === "\\" || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export const fileName = z
  .string()
  .transform((s) => s.normalize("NFC"))
  .pipe(
    z
      .string()
      .min(1)
      .max(255)
      .refine((s) => !hasForbiddenChar(s), "contains a forbidden character")
      .refine((s) => s !== "." && s !== "..", "reserved name")
      .refine((s) => s.trim() === s, "leading or trailing whitespace"),
  );

export const fileKind = z.enum(["file", "folder"]);
export type FileKind = z.infer<typeof fileKind>;

export const fileNode = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  kind: fileKind,
  size: z.number().int().nonnegative(),
  mime: z.string().nullable(),
  /** Null for folders. */
  currentVersionId: z.string().nullable(),
  /** 0 for folders. */
  versionCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});
export type FileNode = z.infer<typeof fileNode>;

export const fileVersion = z.object({
  id: z.string(),
  size: z.number().int().nonnegative(),
  mime: z.string(),
  sha256: z.string(),
  createdAt: z.iso.datetime(),
  current: z.boolean(),
});
export type FileVersion = z.infer<typeof fileVersion>;

export const versionListing = z.object({ versions: z.array(fileVersion) });
export type VersionListing = z.infer<typeof versionListing>;

export const breadcrumb = z.object({ id: z.string(), name: z.string() });
export type Breadcrumb = z.infer<typeof breadcrumb>;

export const folderListing = z.object({
  folder: fileNode,
  /** Root first, current folder last. The root's name is "". */
  breadcrumbs: z.array(breadcrumb),
  /** Folders first, then files; each group sorted by name (case-insensitive). */
  children: z.array(fileNode),
});
export type FolderListing = z.infer<typeof folderListing>;

export const createFolderRequest = z.object({ parentId: z.string(), name: fileName });
export type CreateFolderRequest = z.input<typeof createFolderRequest>;

export const updateFileRequest = z
  .object({ name: fileName.optional(), parentId: z.string().optional() })
  .refine((v) => v.name !== undefined || v.parentId !== undefined);
export type UpdateFileRequest = z.input<typeof updateFileRequest>;

export const trashListing = z.object({
  items: z.array(fileNode),
  /** Items trashed longer ago than this are purged automatically (TRASH_RETENTION_DAYS). */
  retentionDays: z.number().int().positive(),
});
export type TrashListing = z.infer<typeof trashListing>;

export const usageResponse = z.object({
  usedBytes: z.number().int().nonnegative(),
  quotaBytes: z.number().int().nonnegative(),
});
export type UsageResponse = z.infer<typeof usageResponse>;

/**
 * Collision policy for uploads and restores: "report.pdf" → "report (1).pdf" → "report (2).pdf".
 * Folders and dotfiles without an extension get the suffix at the end.
 */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : "";
  for (let n = 1; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

export const existsRequest = z.object({ sha256s: z.array(sha256Hex).min(1).max(1000) });
export type ExistsRequest = z.input<typeof existsRequest>;

export const existsResponse = z.object({ existing: z.array(sha256Hex) });
export type ExistsResponse = z.infer<typeof existsResponse>;
