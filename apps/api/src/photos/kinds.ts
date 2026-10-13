import type { THUMBNAIL_SIZES } from "@cloud/shared";

export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number];

export type MediaKind = "image" | "video";

/** What the timeline treats as a photo: the MIME type decides, the bytes are never sniffed. */
export function mediaKind(mime: string): MediaKind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}
