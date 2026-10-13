import { z } from "zod";

/*
 * Photos contract (session required, scoped to the session user, active files only).
 *
 *   GET    /files/:id/thumbnail?size=256|1024  → image/webp (cached on disk per version and size).
 *            Not an image/video → 404 not_found. Decoding failed or ffmpeg missing → 404
 *            thumbnail_unavailable (the UI shows a generic icon).
 *   GET    /photos?cursor=<opaque>&limit=<1..200, default 100> → PhotoPage
 *            Every active image/* and video/* file of the user, newest takenAt first.
 *            takenAt = EXIF DateTimeOriginal (or video creation time) when known, else the
 *            version's upload time; takenAtSource says which.
 *
 *   GET    /albums                       → AlbumList (newest updated first)
 *   POST   /albums                       CreateAlbumRequest → Album (201)
 *   GET    /albums/:id                   → AlbumDetail (items ordered by takenAt ascending)
 *   PATCH  /albums/:id                   RenameAlbumRequest → Album
 *   DELETE /albums/:id                   → 204 (photos themselves are untouched)
 *   POST   /albums/:id/items             AddAlbumItemsRequest → 204 (duplicates ignored; any
 *                                          foreign, inactive or non-photo id → 404, nothing added)
 *   DELETE /albums/:id/items/:fileId     → 204
 * Trashed photos disappear from the timeline and albums while trashed and return on restore.
 */

export const THUMBNAIL_SIZES = [256, 1024] as const;

export const thumbnailQuery = z.object({
  size: z.coerce
    .number()
    .refine((n): n is (typeof THUMBNAIL_SIZES)[number] =>
      (THUMBNAIL_SIZES as readonly number[]).includes(n),
    )
    .default(256),
});

export const photoItem = z.object({
  fileId: z.string(),
  name: z.string(),
  mime: z.string(),
  kind: z.enum(["image", "video"]),
  takenAt: z.iso.datetime(),
  takenAtSource: z.enum(["exif", "upload"]),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
export type PhotoItem = z.infer<typeof photoItem>;

export const photoPageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const photoPage = z.object({
  items: z.array(photoItem),
  nextCursor: z.string().nullable(),
});
export type PhotoPage = z.infer<typeof photoPage>;

export const albumName = z.string().trim().min(1).max(120);

export const album = z.object({
  id: z.string(),
  name: z.string(),
  itemCount: z.number().int().nonnegative(),
  coverFileId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Album = z.infer<typeof album>;

export const albumList = z.object({ albums: z.array(album) });
export type AlbumList = z.infer<typeof albumList>;

export const createAlbumRequest = z.object({ name: albumName });
export type CreateAlbumRequest = z.input<typeof createAlbumRequest>;

export const renameAlbumRequest = z.object({ name: albumName });
export type RenameAlbumRequest = z.input<typeof renameAlbumRequest>;

export const albumDetail = z.object({ album, items: z.array(photoItem) });
export type AlbumDetail = z.infer<typeof albumDetail>;

export const addAlbumItemsRequest = z.object({ fileIds: z.array(z.string()).min(1).max(500) });
export type AddAlbumItemsRequest = z.input<typeof addAlbumItemsRequest>;
