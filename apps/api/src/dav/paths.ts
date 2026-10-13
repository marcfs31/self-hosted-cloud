import type { IncomingMessage } from "node:http";
import { fileName } from "@cloud/shared";

export const DAV_PREFIX = "/dav";

/**
 * The names a request path consists of, or null when any part is not a valid item name (bad
 * percent-encoding, "." / "..", an encoded "/" or control character, over-long, ...). Each
 * segment is decoded on its own, so "%2F" stays inside one name and is then refused by the
 * shared fileName rules; the result is never joined into a filesystem path, only looked up in
 * the database one name at a time. Empty segments ("a//b", a trailing slash) are ignored.
 */
export function parseSegments(path: string): string[] | null {
  const segments: string[] = [];
  for (const part of path.split("/")) {
    if (part === "") continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    const parsed = fileName.safeParse(decoded);
    if (!parsed.success) return null;
    segments.push(parsed.data);
  }
  return segments;
}

/** The path below the /dav mount, still percent-encoded, without the query string. */
export function mountedPath(req: Pick<IncomingMessage, "url">): string {
  const url = req.url ?? "/";
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
}

/** The percent-encoded URL path of a resource; collections end in a slash. */
export function hrefFor(segments: readonly string[], collection: boolean): string {
  if (segments.length === 0) return `${DAV_PREFIX}/`;
  return `${DAV_PREFIX}/${segments.map(encodeURIComponent).join("/")}${collection ? "/" : ""}`;
}

export function isSamePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** True when `inner` lies strictly below `outer`. */
export function isBelow(inner: readonly string[], outer: readonly string[]): boolean {
  return inner.length > outer.length && outer.every((s, i) => s === inner[i]);
}

/**
 * The segments of a Destination header, or null when it is malformed, names another host, or
 * lies outside /dav. `hosts` are the host names this server answers to (lower case).
 */
export function destinationSegments(
  header: string,
  hosts: readonly string[],
): { segments: string[] | null; local: boolean } {
  let url: URL;
  try {
    url = new URL(header, "http://placeholder.invalid");
  } catch {
    return { segments: null, local: false };
  }
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(header);
  if (absolute && !hosts.includes(url.host.toLowerCase())) return { segments: null, local: false };
  const path = url.pathname;
  const lower = path.toLowerCase();
  if (lower !== DAV_PREFIX && !lower.startsWith(`${DAV_PREFIX}/`)) {
    return { segments: null, local: false };
  }
  return { segments: parseSegments(path.slice(DAV_PREFIX.length)), local: true };
}
