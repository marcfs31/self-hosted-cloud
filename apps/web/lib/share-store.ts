import { SHARE_CACHE, SHARE_NAME_HEADER, shareKeyPrefix } from "../sw/sw-shared";

/**
 * Files received through the Android share sheet. The service worker keeps them in a Cache
 * (see sw/sw.ts) under a random id; this reads them back and forgets them again.
 */

export function sharedFilesSupported(): boolean {
  return typeof caches !== "undefined";
}

/** A name the API accepts: no path separators or control characters, not empty, not too long. */
export function safeFileName(raw: string, index: number): string {
  let replaced = "";
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    replaced += code < 32 || code === 127 || char === "/" || char === "\\" ? "_" : char;
  }
  const cleaned = replaced.trim();
  const name = cleaned.length > 255 ? cleaned.slice(0, 255).trim() : cleaned;
  return name === "" || name === "." || name === ".." ? `shared-${String(index + 1)}` : name;
}

function decodeName(header: string | null): string {
  if (header === null) {
    return "";
  }
  try {
    return decodeURIComponent(header);
  } catch {
    return header;
  }
}

function indexOf(url: string): number {
  return Number(url.slice(url.lastIndexOf("/") + 1));
}

/** The files stored for a share, in the order they were shared. Empty for an unknown id. */
export async function loadShared(id: string): Promise<File[]> {
  const cache = await caches.open(SHARE_CACHE);
  const prefix = shareKeyPrefix(id);
  const keys = (await cache.keys())
    .filter((request) => new URL(request.url).pathname.startsWith(prefix))
    .sort((a, b) => indexOf(a.url) - indexOf(b.url));
  const files: File[] = [];
  for (const [index, key] of keys.entries()) {
    const response = await cache.match(key);
    if (response) {
      const blob = await response.blob();
      const name = safeFileName(decodeName(response.headers.get(SHARE_NAME_HEADER)), index);
      files.push(new File([blob], name, { type: blob.type }));
    }
  }
  return files;
}

export async function clearShared(id: string): Promise<void> {
  const cache = await caches.open(SHARE_CACHE);
  const prefix = shareKeyPrefix(id);
  for (const request of await cache.keys()) {
    if (new URL(request.url).pathname.startsWith(prefix)) {
      await cache.delete(request);
    }
  }
}
