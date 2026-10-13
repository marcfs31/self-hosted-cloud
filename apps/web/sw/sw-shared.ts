/*
 * Logic shared by the service worker (sw.ts) and the pages. It has no DOM or worker types, so
 * both TypeScript programs can include it. tsc emits it next to sw.js as public/sw-shared.js.
 */

export type SwRoute = "network-only" | "network-first-offline" | "share-target" | "precache";

export interface SwRequestInfo {
  url: string;
  method: string;
  /** True for a top-level page load (`request.mode === "navigate"`). */
  navigate: boolean;
}

export const OFFLINE_PATH = "/offline";
export const SHARE_TARGET_PATH = "/share-target";

/** Where the service worker keeps files received through the Android share sheet. */
export const SHARE_CACHE = "cloud-share";
export const SHARE_KEY_PREFIX = "/share-target-files/";
export const SHARE_NAME_HEADER = "x-file-name";
export const SHARE_TIME_HEADER = "x-shared-at";
/** Shared files nobody uploaded are forgotten after this long. */
export const SHARE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isShareId(value: string | null): value is string {
  return value !== null && SHARE_ID.test(value);
}

export function shareKey(id: string, index: number): string {
  return `${SHARE_KEY_PREFIX}${id}/${String(index)}`;
}

export function shareKeyPrefix(id: string): string {
  return `${SHARE_KEY_PREFIX}${id}/`;
}

/** The slice of `Cache` that pruneShares needs; the real Cache fits with K = Request. */
export interface ShareCacheLike<K> {
  keys(): Promise<readonly K[]>;
  match(key: K): Promise<{ headers: { get(name: string): string | null } } | undefined>;
  delete(key: K): Promise<unknown>;
}

/**
 * Deletes the shared files nobody uploaded within SHARE_MAX_AGE_MS. An entry whose time header
 * is missing or unreadable cannot be aged, so it goes too. Returns how many entries it removed.
 */
export async function pruneShares<K>(cache: ShareCacheLike<K>, now: number): Promise<number> {
  let removed = 0;
  for (const key of await cache.keys()) {
    const header = (await cache.match(key))?.headers.get(SHARE_TIME_HEADER) ?? null;
    const sharedAt = header === null || header === "" ? Number.NaN : Number(header);
    if (!Number.isFinite(sharedAt) || now - sharedAt > SHARE_MAX_AGE_MS) {
      await cache.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/**
 * What the service worker does with a request. Nothing under /api is ever cached (file contents
 * and listings are private and must be fresh), and anything not listed goes straight to the
 * network untouched.
 */
export function routeOf(request: SwRequestInfo, origin: string): SwRoute {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return "network-only";
  }
  if (url.origin !== origin) {
    return "network-only";
  }
  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/")) {
    return "network-only";
  }
  const method = request.method.toUpperCase();
  if (method === "POST" && path === SHARE_TARGET_PATH) {
    return "share-target";
  }
  if (method !== "GET") {
    return "network-only";
  }
  if (request.navigate) {
    return "network-first-offline";
  }
  if (path.startsWith("/_next/static/") || path.startsWith("/icons/")) {
    return "precache";
  }
  return "network-only";
}

/** The hashed build files (scripts and styles) a page's HTML refers to. */
export function staticAssetsOf(html: string): string[] {
  const found = html.match(/\/_next\/static\/[^"'\s\\)<>]+/g) ?? [];
  return [...new Set(found)];
}
