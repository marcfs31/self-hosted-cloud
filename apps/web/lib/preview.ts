import type { FileNode } from "@cloud/shared";

/** How the preview dialog shows a file. "none" means: name, size and a Download button. */
export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "none";

/** Text previews read at most this many bytes of the file. */
export const TEXT_PREVIEW_BYTES = 1024 * 1024;

const BY_MIME: Record<string, PreviewKind> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/avif": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "audio/mpeg": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio",
  "application/pdf": "pdf",
  "text/plain": "text",
  "text/markdown": "text",
  "application/json": "text",
  "text/csv": "text",
};

/** Only these types are ever shown; everything else (HTML, SVG, …) is a download. */
export function previewKind(mime: string | null): PreviewKind {
  if (mime === null) {
    return "none";
  }
  const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return Object.hasOwn(BY_MIME, type) ? (BY_MIME[type] ?? "none") : "none";
}

export function isPreviewable(node: Pick<FileNode, "kind" | "mime">): boolean {
  return node.kind === "file" && previewKind(node.mime) !== "none";
}

/**
 * The files the dialog steps through: the previewable ones, in listing order, plus `startId`
 * even when it is not previewable (a search result can be any file).
 */
export function previewSet(nodes: readonly FileNode[], startId: string): FileNode[] {
  return nodes.filter(
    (node) => node.kind === "file" && (node.id === startId || isPreviewable(node)),
  );
}

/** The index to step to from `index`, or null at either end of a list of `length` items. */
export function stepIndex(index: number, length: number, direction: 1 | -1): number | null {
  const next = index + direction;
  return next >= 0 && next < length ? next : null;
}

export interface TextPreview {
  text: string;
  /** True when the file has more bytes than were read. */
  truncated: boolean;
}

/**
 * Reads up to `limit` bytes of `response` and decodes them as UTF-8. A multi-byte character cut
 * by the limit is dropped, not shown as a replacement mark. Stops reading at the limit, so a
 * server that ignores the Range header still costs at most `limit` bytes of memory.
 */
export async function readTextPreview(
  response: Response,
  limit: number = TEXT_PREVIEW_BYTES,
): Promise<TextPreview> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { text: "", truncated: false };
  }
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let read = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const room = limit - read;
    if (value.byteLength > room) {
      text += decoder.decode(value.subarray(0, room), { stream: true });
      truncated = true;
      await reader.cancel();
      break;
    }
    read += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (read === limit) {
      // The file may end exactly here; one more read tells the two cases apart.
      const next = await reader.read();
      if (!next.done) {
        truncated = true;
        await reader.cancel();
      }
      break;
    }
  }
  if (!truncated) {
    text += decoder.decode();
  }
  return { text, truncated };
}
