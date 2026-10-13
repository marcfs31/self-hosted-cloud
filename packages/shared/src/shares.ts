import { z } from "zod";
import { breadcrumb, fileKind } from "./files.js";

/*
 * Sharing contract.
 *
 * Owner endpoints (session required, scoped to the owner):
 *   POST   /shares        CreateShareRequest → CreatedShareResponse (201; token shown once)
 *                           fileId must be an active file or folder of the user, not the root.
 *                           allowUpload only for folders; such a link is a DROP BOX: upload-only,
 *                           it never lists or serves anything.
 *   GET    /shares        → ListSharesResponse (the user's non-revoked shares, newest first)
 *   DELETE /shares/:id    → 204 (revoke)
 *
 * Public endpoints (no session; :token is the raw share token). Any of: unknown token,
 * revoked, expired, or target no longer active → 404 not_found, never the content.
 *   GET    /public/shares/:token                         → PublicShareInfo
 *   POST   /public/shares/:token/unlock                  UnlockShareRequest → 204, sets an HttpOnly
 *            grant cookie scoped to /api/public/shares/<token> valid 1 hour. Wrong password →
 *            401 invalid_credentials; rate-limited like login (429 too_many_attempts).
 *   Password-protected shares answer 401 share_locked on every endpoint below until unlocked.
 *   GET    /public/shares/:token/content                 → file share: the bytes (same safe
 *            headers as /files/:id/content; ?download=1 forces attachment)
 *   GET    /public/shares/:token/folder?folderId=<id>    → PublicFolderListing (folder share;
 *            folderId defaults to the shared folder and must lie inside it)
 *   GET    /public/shares/:token/files/:id/content       → a file inside a folder share
 *   GET    /public/shares/:token/zip?folderId=<id>       → application/zip, streamed, store-only
 *   tus    /public/shares/:token/uploads                 → drop-box uploads into the shared folder
 *            (same tus rules as /uploads but parentId is fixed to the shared folder, replaceId is
 *            not allowed, names collide to "name (1).ext", the owner's quota applies).
 *            Creations (POST, empty files included, refused ones too) are limited to 100 per visitor
 *            address and share per hour and 1000 per share per day → 429 too_many_attempts.
 *   Folder-browse endpoints on a drop box, and uploads on a non-drop-box share → 404 not_found.
 * State-changing public requests still require Origin === PUBLIC_ORIGIN.
 */

export const DEFAULT_SHARE_EXPIRY_DAYS = 7;

export const createShareRequest = z.object({
  fileId: z.string(),
  /** null = never expires. */
  expiresInDays: z.int().min(1).max(365).nullable().default(DEFAULT_SHARE_EXPIRY_DAYS),
  password: z.string().min(8).max(1024).optional(),
  allowUpload: z.boolean().default(false),
});
export type CreateShareRequest = z.input<typeof createShareRequest>;

export const share = z.object({
  id: z.string(),
  fileId: z.string(),
  fileName: z.string(),
  kind: fileKind,
  allowUpload: z.boolean(),
  hasPassword: z.boolean(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
});
export type Share = z.infer<typeof share>;

export const createdShareResponse = z.object({ share, token: z.string() });
export type CreatedShareResponse = z.infer<typeof createdShareResponse>;

export const listSharesResponse = z.object({ shares: z.array(share) });
export type ListSharesResponse = z.infer<typeof listSharesResponse>;

export const publicShareInfo = z.object({
  name: z.string(),
  kind: fileKind,
  allowUpload: z.boolean(),
  requiresPassword: z.boolean(),
  /** True when no password is needed or the grant cookie is valid. */
  unlocked: z.boolean(),
  /** File shares only. */
  size: z.number().int().nonnegative().nullable(),
  mime: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export type PublicShareInfo = z.infer<typeof publicShareInfo>;

export const unlockShareRequest = z.object({ password: z.string().min(1).max(1024) });
export type UnlockShareRequest = z.input<typeof unlockShareRequest>;

/** No owner, parent or version information ever leaves a public endpoint. */
export const publicNode = z.object({
  id: z.string(),
  name: z.string(),
  kind: fileKind,
  size: z.number().int().nonnegative(),
  mime: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type PublicNode = z.infer<typeof publicNode>;

export const publicFolderListing = z.object({
  folder: publicNode,
  /** From the shared folder (first) to the current folder (last). */
  breadcrumbs: z.array(breadcrumb),
  children: z.array(publicNode),
});
export type PublicFolderListing = z.infer<typeof publicFolderListing>;
